import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

export interface DatabaseConfig {
  connectionString: string
  max?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
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

  constructor(config: DatabaseConfig, logger: DatabaseLogger = defaultLogger) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis
    })
    this.logger = logger
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
    const metrics: QueryMetrics = {
      text,
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

  async getClient(): Promise<PoolClient> {
    return this.pool.connect()
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
