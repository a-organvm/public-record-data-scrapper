function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Parse Redis URL into components
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined
    }
  } catch {
    return { host: 'localhost', port: 6379 }
  }
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const parsedRedis = parseRedisUrl(redisUrl)

const isProduction = process.env.NODE_ENV === 'production'

// In production, JWT_SECRET is required - no fallback allowed
const jwtSecret =
  process.env.JWT_SECRET || (isProduction ? '' : 'development-secret-change-in-production')

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0'
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      process.env.TEST_DATABASE_URL ||
      'postgresql://localhost:5432/ucc_intelligence',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  },
  cors: {
    origin:
      process.env.CORS_ORIGIN?.split(',') ||
      (isProduction ? [] : ['http://localhost:5173', 'http://localhost:5000']),
    credentials: true
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // requests per window
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: '1h',
    refreshExpiresIn: '7d'
  },
  auth0: {
    domain: process.env.AUTH0_DOMAIN || '',
    clientId: process.env.AUTH0_CLIENT_ID || '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET || '',
    audience: process.env.AUTH0_AUDIENCE || ''
  },
  redis: {
    url: redisUrl,
    host: parsedRedis.host,
    port: parsedRedis.port,
    password: parsedRedis.password,
    maxRetriesPerRequest: 3
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceIds: {
      starter: process.env.STRIPE_PRICE_ID_STARTER || '',
      professional: process.env.STRIPE_PRICE_ID_PROFESSIONAL || ''
    }
  },
  telemetry: {
    skipHydration: parseBooleanFlag(process.env.INGESTION_TELEMETRY_SKIP_HYDRATION),
    hydrateHistoryLimit: parsePositiveInt(process.env.INGESTION_TELEMETRY_HISTORY_LIMIT, 50)
  }
}

/**
 * Validates that required configuration is present for production.
 * Call this at server startup.
 * @throws Error if required config is missing in production
 */
export function validateConfig(): void {
  const errors: string[] = []

  if (isProduction) {
    if (!process.env.JWT_SECRET) {
      errors.push('JWT_SECRET is required in production')
    }
    if (!process.env.DATABASE_URL) {
      errors.push('DATABASE_URL is required in production')
    }
    if (config.cors.origin.length === 0 && !process.env.CORS_ORIGIN) {
      errors.push('CORS_ORIGIN is required in production')
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`)
  }
}
