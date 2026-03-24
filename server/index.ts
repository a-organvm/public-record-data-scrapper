import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import path from 'path'
import fs from 'fs'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yamljs'
import { config, validateConfig } from './config'
import { database } from './database/connection'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import { requestLogger } from './middleware/requestLogger'
import { createRateLimiter, closeRateLimiterConnection } from './middleware/rateLimiter'
import { authMiddleware } from './middleware/authMiddleware'
import { httpsRedirect } from './middleware/httpsRedirect'
import { dataTierRouter } from './middleware/dataTier'
import { auditMiddleware } from './middleware/auditMiddleware'

// Import routes
import prospectsRouter from './routes/prospects'
import competitorsRouter from './routes/competitors'
import portfolioRouter from './routes/portfolio'
import enrichmentRouter from './routes/enrichment'
import healthRouter from './routes/health'
import jobsRouter from './routes/jobs'
import contactsRouter from './routes/contacts'
import dealsRouter from './routes/deals'
import webhooksRouter from './routes/webhooks'
import statusRouter from './routes/status'
import competitiveRouter from './routes/competitive'
import outreachRouter from './routes/outreach'

// Import queue infrastructure
import {
  initializeQueues,
  closeQueues,
  initTelemetryPersistence,
  hydrateTelemetryFromDatabase
} from './queue/queues'
import { jobScheduler } from './queue/scheduler'
import { redisConnection } from './queue/connection'

export class Server {
  private app: Express

  constructor() {
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
    this.setupErrorHandling()
  }

  private setupMiddleware(): void {
    // HTTPS redirect (before everything else in production)
    this.app.use(httpsRedirect)

    // Security headers
    this.app.use(helmet())
    this.app.use(
      cors({
        origin: config.cors.origin,
        credentials: config.cors.credentials
      })
    )

    // Raw body middleware for webhooks (must be before JSON parser)
    // This preserves the raw body for signature verification
    this.app.use(
      '/api/webhooks',
      express.raw({
        type: 'application/json',
        limit: '1mb',
        verify: (req: Request, res: Response, buf: Buffer) => {
          // Store raw body for signature verification
          ;(req as Request & { rawBody?: Buffer }).rawBody = buf
        }
      })
    )

    // Parsing for webhook form data (Twilio sends as x-www-form-urlencoded)
    this.app.use('/api/webhooks', express.urlencoded({ extended: true, limit: '1mb' }))

    // Parsing (for all other routes)
    this.app.use(express.json({ limit: '10mb' }))
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }))

    // Compression
    this.app.use(compression())

    // Logging
    this.app.use(requestLogger)

    // Data tier routing (OSS -> free-tier, paid -> starter-tier)
    this.app.use(dataTierRouter)

    // Rate limiting (Redis-based in production, in-memory in development)
    this.app.use(createRateLimiter())

    // Audit logging for compliance tracking
    this.app.use(auditMiddleware)
  }

  private setupRoutes(): void {
    // Swagger UI documentation
    this.setupSwaggerDocs()

    // Public status page (no auth, bookmarkable)
    this.app.use(statusRouter)

    // Public routes (no authentication required)
    this.app.use('/api/health', healthRouter)

    // Webhook routes (signature verification, no JWT auth)
    this.app.use('/api/webhooks', webhooksRouter)

    // Protected API routes (authentication required)
    this.app.use('/api/prospects', authMiddleware, prospectsRouter)
    this.app.use('/api/competitors', authMiddleware, competitorsRouter)
    this.app.use('/api/portfolio', authMiddleware, portfolioRouter)
    this.app.use('/api/enrichment', authMiddleware, enrichmentRouter)
    this.app.use('/api/jobs', authMiddleware, jobsRouter)
    this.app.use('/api/contacts', authMiddleware, contactsRouter)
    this.app.use('/api/deals', authMiddleware, dealsRouter)
    this.app.use('/api/competitive', authMiddleware, competitiveRouter)
    this.app.use('/api/outreach', authMiddleware, outreachRouter)

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'UCC-MCA Intelligence API',
        version: '1.0.0',
        status: 'ok',
        documentation: '/api/docs',
        endpoints: {
          prospects: '/api/prospects',
          competitors: '/api/competitors',
          portfolio: '/api/portfolio',
          enrichment: '/api/enrichment',
          health: '/api/health',
          jobs: '/api/jobs',
          contacts: '/api/contacts',
          deals: '/api/deals',
          competitive: '/api/competitive',
          outreach: '/api/outreach',
          webhooks: '/api/webhooks'
        }
      })
    })
  }

  private setupSwaggerDocs(): void {
    try {
      // Load OpenAPI spec from YAML file
      const openApiPath = path.join(__dirname, 'openapi.yaml')

      if (fs.existsSync(openApiPath)) {
        const openApiSpec = YAML.load(openApiPath)

        // Swagger UI options
        const swaggerOptions: swaggerUi.SwaggerUiOptions = {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'UCC-MCA Intelligence API Docs',
          swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            filter: true,
            showExtensions: true,
            showCommonExtensions: true
          }
        }

        // Serve Swagger UI at /api/docs
        this.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, swaggerOptions))

        // Serve raw OpenAPI spec as JSON
        this.app.get('/api/docs/openapi.json', (req, res) => {
          res.json(openApiSpec)
        })

        // Serve raw OpenAPI spec as YAML
        this.app.get('/api/docs/openapi.yaml', (req, res) => {
          res.type('text/yaml').sendFile(openApiPath)
        })

        console.log('[Server] Swagger UI enabled at /api/docs')
      } else {
        console.warn('[Server] OpenAPI spec not found at', openApiPath)

        // Serve placeholder when spec is missing
        this.app.get('/api/docs', (req, res) => {
          res.status(503).json({
            error: 'API documentation not available',
            message: 'OpenAPI specification file not found'
          })
        })
      }
    } catch (error) {
      console.error('[Server] Failed to load OpenAPI spec:', error)

      // Serve error message when spec fails to load
      this.app.get('/api/docs', (req, res) => {
        res.status(503).json({
          error: 'API documentation not available',
          message: 'Failed to load OpenAPI specification'
        })
      })
    }
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler)

    // Global error handler
    this.app.use(errorHandler)
  }

  async start(): Promise<void> {
    const port = config.server.port
    const host = config.server.host

    // Validate configuration
    try {
      validateConfig()
    } catch (error) {
      console.error('Configuration error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }

    // Connect to database
    try {
      await database.connect()
    } catch (error) {
      console.error('Failed to connect to database:', error)
      process.exit(1)
    }

    // Initialize telemetry persistence and hydrate from database
    initTelemetryPersistence(database)
    const hydratedCount = await hydrateTelemetryFromDatabase()
    console.log(`[telemetry] Hydrated ${hydratedCount} states from database`)

    // Initialize job queues
    try {
      initializeQueues()
    } catch (error) {
      console.error('Failed to initialize job queues:', error)
      process.exit(1)
    }

    // Start job scheduler
    try {
      await jobScheduler.start()
    } catch (error) {
      console.error('Failed to start job scheduler:', error)
      process.exit(1)
    }

    // Start server
    this.app.listen(port, host, () => {
      console.log('')
      console.log('🚀 UCC-MCA Intelligence API Server')
      console.log('─────────────────────────────────────')
      console.log(`  Environment: ${config.server.env}`)
      console.log(`  Server:      http://${host}:${port}`)
      console.log(`  Health:      http://${host}:${port}/api/health`)
      console.log(`  Jobs:        http://${host}:${port}/api/jobs`)
      console.log(`  Database:    ${this.maskConnectionString(config.database.url)}`)
      console.log(`  Redis:       ${config.redis.host}:${config.redis.port}`)
      console.log(`  Docs:        http://${host}:${port}/api/docs`)
      console.log('─────────────────────────────────────')
      console.log('')
    })
  }

  async shutdown(): Promise<void> {
    console.log('')
    console.log('Shutting down server...')

    // Stop job scheduler
    jobScheduler.stop()

    // Close queues
    await closeQueues()

    // Close rate limiter Redis connection
    await closeRateLimiterConnection()

    // Disconnect from Redis
    await redisConnection.disconnect()

    // Disconnect from database
    await database.disconnect()

    console.log('✓ Server shutdown complete')
    process.exit(0)
  }

  private maskConnectionString(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`
    } catch {
      return 'postgresql://***:***@***/***'
    }
  }

  getApp(): Express {
    return this.app
  }
}

// Start server if this file is run directly
const server = new Server()
server.start()

// Graceful shutdown
process.on('SIGTERM', () => server.shutdown())
process.on('SIGINT', () => server.shutdown())

export default Server
