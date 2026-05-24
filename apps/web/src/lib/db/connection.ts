import { Pool, PoolConfig } from 'pg'

// Database connection configuration
const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ucc_mca',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000')
}

// Create connection pool
let pool: Pool | null = null

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool(poolConfig)

    // Handle pool errors.
    // Do NOT call process.exit() here: an error on an idle client should not
    // tear down the whole process (this module is also bundled into the
    // frontend, where exiting is never appropriate). `pg` removes the broken
    // client from the pool automatically, so we just log and let the pool
    // recover by creating fresh connections on demand.
    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err)
    })

    // Log pool creation
    console.log('Database connection pool created')
  }

  return pool
}

// Get a client from the pool
export const getClient = async () => {
  const pool = getPool()
  return pool.connect()
}

// Query helper
export const query = async (text: string, params?: Array<unknown>) => {
  const pool = getPool()
  const start = Date.now()

  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start

    if (process.env.DB_LOG_QUERIES === 'true') {
      console.log('Executed query', { text, duration, rows: res.rowCount })
    }

    return res
  } catch (error) {
    console.error('Database query error', { text, error })
    throw error
  }
}

// Close pool (for cleanup)
export const closePool = async () => {
  if (pool) {
    await pool.end()
    pool = null
    console.log('Database connection pool closed')
  }
}

// Test database connection
export const testConnection = async (): Promise<boolean> => {
  try {
    const result = await query('SELECT NOW()')
    console.log('Database connection successful:', result.rows[0])
    return true
  } catch (error) {
    console.error('Database connection failed:', error)
    return false
  }
}
