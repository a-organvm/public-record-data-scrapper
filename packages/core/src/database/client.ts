/**
 * Database Client with Connection Pooling
 *
 * Provides a robust PostgreSQL client with:
 * - Connection pooling (PgBouncer compatible)
 * - Query timeout handling
 * - Automatic retry logic
 * - Query logging and metrics
 * - Transaction support
 *
 * This is the canonical database client for the MCA Platform.
 * All services should use this client instead of creating their own.
 */

import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg'

export interface DatabaseConfig extends PoolConfig {
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  connectionString?: string
  // Connection pooling
  max?: number // Maximum pool size
  min?: number // Minimum pool size
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
  // Query settings
  statement_timeout?: number // Query timeout in ms
  query_timeout?: number
  // SSL settings
  ssl?:
    | boolean
    | {
        rejectUnauthorized?: boolean
        ca?: string
        key?: string
        cert?: string
      }
}

export interface QueryOptions {
  timeout?: number
  retries?: number
  logQuery?: boolean
  name?: string // For prepared statements
}

export interface QueryMetrics {
  query: string
  duration: number
  rows: number
  timestamp: string
  error?: string
}

export interface DatabaseLogger {
  error(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

// Default console-based logger
const defaultLogger: DatabaseLogger = {
  error: (msg, meta) => console.error(`[DB ERROR] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[DB WARN] ${msg}`, meta || ''),
  info: (msg, meta) => console.info(`[DB INFO] ${msg}`, meta || ''),
  debug: (msg, meta) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.debug(`[DB DEBUG] ${msg}`, meta || '')
    }
  }
}

export class DatabaseClient {
  private pool: Pool
  private metrics: QueryMetrics[] = []
  private maxMetricsSize = 1000 // Keep last 1000 queries
  private logger: DatabaseLogger

  constructor(config: DatabaseConfig, logger?: DatabaseLogger) {
    this.logger = logger || defaultLogger

    const poolConfig: PoolConfig = {
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || parseInt(process.env.DB_PORT || '5432'),
      database: config.database || process.env.DB_NAME || 'ucc_mca_db',
      user: config.user || process.env.DB_USER || 'postgres',
      password: config.password || process.env.DB_PASSWORD || '',
      connectionString: config.connectionString || process.env.DATABASE_URL,
      max: config.max || 20, // Default: 20 connections
      min: config.min || 2, // Default: 2 idle connections
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,
      statement_timeout: config.statement_timeout || 30000, // 30 second timeout
      query_timeout: config.query_timeout || 30000,
      ssl: config.ssl || false
    }

    // If connectionString is provided, use it instead of individual params
    if (poolConfig.connectionString) {
      delete poolConfig.host
      delete poolConfig.port
      delete poolConfig.database
      delete poolConfig.user
      delete poolConfig.password
    }

    this.pool = new Pool(poolConfig)

    // Handle pool errors
    this.pool.on('error', (err) => {
      this.logger.error('Unexpected error on idle client', { error: err.message })
    })

    // Handle pool connection
    this.pool.on('connect', () => {
      this.logger.debug('New client connected to database')
    })

    // Handle pool removal
    this.pool.on('remove', () => {
      this.logger.debug('Client removed from pool')
    })

    this.logger.info('Database client initialized', {
      host: poolConfig.host || 'from connection string',
      database: poolConfig.database || 'from connection string',
      maxConnections: poolConfig.max
    })
  }

  /**
   * Execute a query
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: Array<unknown>,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const startTime = Date.now()
    const retries = options?.retries || 1
    let lastError: Error | null = null

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (options?.logQuery !== false) {
          this.logger.debug('Executing query', {
            query: text.slice(0, 200), // Truncate for logging
            params: params,
            attempt: attempt + 1
          })
        }

        const result = await this.pool.query<T>(text, params)

        const duration = Date.now() - startTime

        // Record metrics
        this.recordMetrics({
          query: text,
          duration,
          rows: result.rowCount || 0,
          timestamp: new Date().toISOString()
        })

        this.logger.debug('Query completed', {
          duration: `${duration}ms`,
          rows: result.rowCount
        })

        return result
      } catch (error) {
        lastError = error as Error
        const duration = Date.now() - startTime

        this.logger.error('Query failed', {
          query: text.slice(0, 200),
          error: lastError.message,
          duration: `${duration}ms`,
          attempt: attempt + 1
        })

        // Record error metrics
        this.recordMetrics({
          query: text,
          duration,
          rows: 0,
          timestamp: new Date().toISOString(),
          error: lastError.message
        })

        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          break
        }

        // Wait before retry
        if (attempt < retries - 1) {
          await this.sleep(Math.pow(2, attempt) * 100) // Exponential backoff
        }
      }
    }

    throw lastError
  }

  /**
   * Execute a query and return rows directly
   */
  async queryRows<T = Record<string, unknown>>(
    text: string,
    params?: Array<unknown>,
    options?: QueryOptions
  ): Promise<T[]> {
    const result = await this.query<T & QueryResultRow>(text, params, options)
    return result.rows
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      this.logger.debug('Transaction started')

      const result = await callback(client)

      await client.query('COMMIT')
      this.logger.debug('Transaction committed')

      return result
    } catch (error) {
      await client.query('ROLLBACK')
      this.logger.error('Transaction rolled back', { error })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get a client from the pool (for manual transaction control)
   */
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect()
  }

  /**
   * Test database connection
   */
  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 as ping')
      return true
    } catch (error) {
      this.logger.error('Database ping failed', { error })
      return false
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount
    }
  }

  /**
   * Get query metrics
   */
  getMetrics(): QueryMetrics[] {
    return [...this.metrics]
  }

  /**
   * Get average query duration
   */
  getAverageQueryDuration(): number {
    if (this.metrics.length === 0) return 0

    const total = this.metrics.reduce((sum, m) => sum + m.duration, 0)
    return total / this.metrics.length
  }

  /**
   * Get slow queries (above threshold)
   */
  getSlowQueries(thresholdMs: number = 1000): QueryMetrics[] {
    return this.metrics.filter((m) => m.duration > thresholdMs)
  }

  /**
   * Clear metrics
   */
  clearMetrics(): void {
    this.metrics = []
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    this.logger.info('Closing database connection pool')
    await this.pool.end()
  }

  /**
   * Record query metrics
   */
  private recordMetrics(metrics: QueryMetrics): void {
    this.metrics.push(metrics)

    // Trim metrics if exceeding max size
    if (this.metrics.length > this.maxMetricsSize) {
      this.metrics.shift()
    }
  }

  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(error: Error): boolean {
    const nonRetryableErrors = [
      'syntax error',
      'permission denied',
      'relation does not exist',
      'column does not exist',
      'duplicate key value',
      'violates foreign key constraint',
      'violates not-null constraint',
      'invalid input syntax'
    ]

    return nonRetryableErrors.some((msg) => error.message.toLowerCase().includes(msg))
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Singleton instance
let dbClient: DatabaseClient | null = null

/**
 * Get database client instance (singleton)
 */
export function getDatabase(config?: DatabaseConfig, logger?: DatabaseLogger): DatabaseClient {
  if (!dbClient && config) {
    dbClient = new DatabaseClient(config, logger)
  }

  if (!dbClient) {
    throw new Error('Database client not initialized. Call getDatabase(config) first.')
  }

  return dbClient
}

/**
 * Initialize database client (explicit initialization)
 */
export function initDatabase(config: DatabaseConfig, logger?: DatabaseLogger): DatabaseClient {
  if (dbClient) {
    throw new Error('Database client already initialized. Use getDatabase() to get the instance.')
  }
  dbClient = new DatabaseClient(config, logger)
  return dbClient
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbClient) {
    await dbClient.close()
    dbClient = null
  }
}

/**
 * Reset database client (for testing)
 */
export function resetDatabaseClient(): void {
  dbClient = null
}
