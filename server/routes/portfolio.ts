import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { PortfolioService } from '../services/PortfolioService'

const router = Router()

// Validation schemas
const MAX_PAGE_LIMIT = 200

const querySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  // Clamp limit to a sane maximum before it reaches the DB to bound query cost.
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Math.min(Math.max(Number(v), 1), MAX_PAGE_LIMIT))
    .default('20'),
  health_grade: z.enum(['A', 'B', 'C', 'D', 'F']).optional(),
  sort_by: z.enum(['funded_date', 'health_score', 'company_name']).default('funded_date'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
})

const idParamSchema = z.object({
  id: z.string().uuid()
})

type PortfolioQuery = z.infer<typeof querySchema>

// GET /api/portfolio - List portfolio companies
router.get(
  '/',
  validateRequest({ query: querySchema }),
  asyncHandler(async (req, res) => {
    const portfolioService = new PortfolioService()
    const result = await portfolioService.list(req.query as PortfolioQuery)

    res.json({
      companies: result.companies,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

// GET /api/portfolio/:id - Get portfolio company details
router.get(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const portfolioService = new PortfolioService()
    const company = await portfolioService.getById(req.params.id)

    if (!company) {
      return res.status(404).json({
        error: {
          message: `Portfolio company ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(company)
  })
)

// GET /api/portfolio/:id/health-history - Get health score history
router.get(
  '/:id/health-history',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const portfolioService = new PortfolioService()
    const history = await portfolioService.getHealthHistory(req.params.id)

    res.json(history)
  })
)

// GET /api/portfolio/stats - Get portfolio statistics
router.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
    const portfolioService = new PortfolioService()
    const stats = await portfolioService.getStats()

    res.json(stats)
  })
)

export default router
