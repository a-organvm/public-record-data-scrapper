import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { CompetitorsService } from '../services/CompetitorsService'
import { getResolvedDataTier } from '../middleware/dataTier'

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
  state: z.string().length(2).optional(),
  sort_by: z.enum(['filing_count', 'total_amount', 'name']).default('filing_count'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
})

const idParamSchema = z.object({
  id: z.string().uuid()
})

type CompetitorsQuery = z.infer<typeof querySchema>

// GET /api/competitors - List competitors (secured parties)
router.get(
  '/',
  validateRequest({ query: querySchema }),
  asyncHandler(async (req, res) => {
    const competitorsService = new CompetitorsService()
    const dataTier = getResolvedDataTier(req)
    const result = await competitorsService.list(req.query as CompetitorsQuery, dataTier)

    res.json({
      competitors: result.competitors,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

// GET /api/competitors/:id - Get competitor details
router.get(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const competitorsService = new CompetitorsService()
    const competitor = await competitorsService.getById(req.params.id)

    if (!competitor) {
      return res.status(404).json({
        error: {
          message: `Competitor ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(competitor)
  })
)

// GET /api/competitors/:id/analysis - Get SWOT analysis for competitor
router.get(
  '/:id/analysis',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const competitorsService = new CompetitorsService()
    const analysis = await competitorsService.getAnalysis(req.params.id)

    if (!analysis) {
      return res.status(404).json({
        error: {
          message: `Competitor ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(analysis)
  })
)

// GET /api/competitors/stats - Get competitor statistics
router.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
    const competitorsService = new CompetitorsService()
    const stats = await competitorsService.getStats()

    res.json(stats)
  })
)

export default router
