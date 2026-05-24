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
    const result = await this.pool.query<T>(text, params as unknown[] | undefined)
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
