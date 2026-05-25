import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg'

export interface DatabaseConfig {
  connectionString: string
  max?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
  /**
   * SSL configuration. When `true`, TLS is required (equivalent to
   * sslmode=require). For self-signed/managed certs without a CA bundle, pass
   * `{ rejectUnauthorized: false }`. Defaults are derived from env when omitted.
   */
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string }
  /**
   * When true, the SQL text of each query is included in debug logs. Off by
   * default because query text can contain PII (names, emails, etc.). Parameter
   * VALUES are never logged regardless of this flag.
   */
  logQueryText?: boolean
}

const DEFAULT_POOL_MAX = 10
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveSsl(
  config: DatabaseConfig
): PoolConfig['ssl'] {
  if (config.ssl !== undefined) {
    return config.ssl === true ? { rejectUnauthorized: true } : config.ssl
  }
  // Env-driven defaults: PGSSLMODE=require / DATABASE_SSL=true enable TLS.
  const sslMode = (process.env.PGSSLMODE || '').toLowerCase()
  const sslEnv = (process.env.DATABASE_SSL || '').toLowerCase()
  if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
    return { rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca' }
  }
  if (sslEnv === 'true' || sslEnv === '1' || sslEnv === 'require') {
    return { rejectUnauthorized: false }
  }
  return undefined
}

export interface QueryOptions {
  text: string
  values?: unknown[]
}

export interface QueryMetrics {
  text: string
  durationMs: number
  rowCount: number
  // Index signature so metrics can be passed directly to the structured
  // logger (which accepts Record<string, unknown> meta).
  [key: string]: unknown
}

export interface DatabaseLogger {
  error: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  debug: (message: string, meta?: Record<string, unknown>) => void
}

const defaultLogger: DatabaseLogger = {
  error: (message, meta) => console.error(message, meta),
  warn: (message, meta) => console.warn(message, meta),
  info: (message, meta) => console.info(message, meta),
  debug: (message, meta) => console.debug(message, meta)
}

/**
 * Optional provider that returns the current request's tenant (organization)
 * id. Injected by the server layer (see server/database/connection.ts) so this
 * package stays free of any server/middleware import — the provider typically
 * reads an AsyncLocalStorage store populated by orgContextMiddleware.
 *
 * Default is a no-op returning `undefined`, which means: no tenant context, so
 * `query()` takes the plain `pool.query` fast path with EXACTLY the same
 * behavior as before this hook existed. This passthrough is load-bearing —
 * code paths (and tests) that never call `setOrgContextProvider` must be
 * completely unaffected.
 */
type OrgContextProvider = () => string | undefined

let orgContextProvider: OrgContextProvider = () => undefined

/**
 * Install the org-context provider used to derive `app.current_org_id` per
 * query. Call once at startup. Passing `undefined` clears it back to the
 * no-op default (useful in tests).
 *
 * NOTE ON RLS: setting `app.current_org_id` only changes what rows are visible
 * when the application connects as a NON-OWNER DB role. The Row-Level Security
 * policies from migration 018 are not FORCEd, so the table owner (and any
 * BYPASSRLS/superuser role) is exempt and sees all rows regardless of the GUC.
 * Migrations run as the owner by design; run the app under a dedicated
 * non-owner role for tenant isolation to take effect.
 */
export function setOrgContextProvider(provider?: OrgContextProvider): void {
  orgContextProvider = provider ?? (() => undefined)
}

export class DatabaseClient {
  private readonly pool: Pool
  private readonly logger: DatabaseLogger
  private readonly logQueryText: boolean

  constructor(config: DatabaseConfig, logger: DatabaseLogger = defaultLogger) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      // Sensible pool defaults, overridable via config or env.
      max: config.max ?? envInt('DATABASE_POOL_MAX', DEFAULT_POOL_MAX),
      idleTimeoutMillis:
        config.idleTimeoutMillis ?? envInt('DATABASE_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS),
      connectionTimeoutMillis:
        config.connectionTimeoutMillis ??
        envInt('DATABASE_CONNECTION_TIMEOUT_MS', DEFAULT_CONNECTION_TIMEOUT_MS),
      ssl: resolveSsl(config)
    })
    this.logger = logger
    // Query text can contain PII; gate it behind an explicit flag / env.
    this.logQueryText =
      config.logQueryText ?? process.env.DATABASE_LOG_QUERY_TEXT === 'true'
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1')
      return true
    } catch (error) {
      this.logger.error('Database ping failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    textOrOptions: string | QueryOptions,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    const { text, params } =
      typeof textOrOptions === 'string'
        ? { text: textOrOptions, params: values }
        : { text: textOrOptions.text, params: textOrOptions.values }

    const startedAt = Date.now()
    // Tenant context: when a provider is installed AND yields an orgId, run on
    // a dedicated client that SETs the `app.current_org_id` GUC so RLS policies
    // (migration 018) scope visible rows. When there is no provider/orgId this
    // is bypassed entirely and the plain pool.query path below is used — that
    // passthrough MUST stay byte-identical to the pre-existing behavior.
    const orgId = orgContextProvider()
    const result = orgId
      ? await this.queryWithOrgContext<T>(orgId, text, params as unknown[] | undefined)
      : await this.pool.query<T>(text, params as unknown[] | undefined)
    // Never log parameter values (PII). Only include the SQL text when the
    // operator explicitly opts in via logQueryText; otherwise redact it.
    const metrics: QueryMetrics = {
      text: this.logQueryText ? text : '[redacted]',
      durationMs: Date.now() - startedAt,
      rowCount: result.rowCount ?? 0
    }

    this.logger.debug('Database query completed', metrics)

    return result
  }

  /**
   * Run a single query on a dedicated pooled client after setting the
   * `app.current_org_id` GUC (session-scoped) so Row-Level Security policies
   * can scope rows to the tenant. The GUC is RESET and the client released in
   * a finally block so the connection is safe to return to the pool. A failed
   * RESET is swallowed (best effort) to avoid masking the original result.
   */
  private async queryWithOrgContext<T extends QueryResultRow = QueryResultRow>(
    orgId: string,
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const client = await this.pool.connect()
    try {
      await client.query("SELECT set_config('app.current_org_id', $1, false)", [orgId])
      return await client.query<T>(text, params)
    } finally {
      await client.query('RESET app.current_org_id').catch(() => {})
      client.release()
    }
  }

  async queryRows<T = Record<string, unknown>>(
    textOrOptions: string | QueryOptions,
    values?: unknown[]
  ): Promise<T[]> {
    const result = await this.query<QueryResultRow>(textOrOptions, values)
    return result.rows as T[]
  }

  /**
   * Acquire a raw pooled client. Prefer `withClient`/`withTransaction` which
   * guarantee the client is released. If you call this directly, you MUST call
   * `client.release()` in a finally block.
   */
  async getClient(): Promise<PoolClient> {
    return this.pool.connect()
  }

  /**
   * Run `fn` with a dedicated pooled client and guarantee release() afterwards,
   * even if `fn` throws. Use for multi-statement work that must run on one
   * connection (e.g. SET app.current_org_id + queries).
   */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  }

  /**
   * Run `fn` inside a transaction on a single pooled client. COMMITs on success,
   * ROLLBACKs on error, and always releases the client.
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      try {
        await client.query('BEGIN')
        const result = await fn(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError) {
          this.logger.error('Database transaction rollback failed', {
            error:
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          })
        }
        throw error
      }
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

let databaseClient: DatabaseClient | null = null

export function initDatabase(
  config: DatabaseConfig,
  logger: DatabaseLogger = defaultLogger
): DatabaseClient {
  databaseClient = new DatabaseClient(config, logger)
  return databaseClient
}

export function getDatabase(
  config?: DatabaseConfig,
  logger: DatabaseLogger = defaultLogger
): DatabaseClient {
  if (!databaseClient) {
    if (!config) {
      throw new Error('Database client not initialized. Provide a config or call initDatabase().')
    }

    databaseClient = new DatabaseClient(config, logger)
  }

  return databaseClient
}

export async function closeDatabase(): Promise<void> {
  if (!databaseClient) {
    return
  }

  await databaseClient.close()
  databaseClient = null
}

export function resetDatabaseClient(): void {
  databaseClient = null
}
