import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { ProspectsService } from '../services/ProspectsService'
import { getResolvedDataTier, type ResolvedDataTier } from '../middleware/dataTier'

const router = Router()

// Validation schemas
const MAX_PAGE_LIMIT = 200

const querySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  // Clamp limit to a sane maximum before it reaches the DB (tier constraints
  // may reduce it further) to bound query cost.
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Math.min(Math.max(Number(v), 1), MAX_PAGE_LIMIT))
    .default('20'),
  state: z.string().length(2).optional(),
  industry: z.string().optional(),
  min_score: z.string().regex(/^\d+$/).transform(Number).optional(),
  max_score: z.string().regex(/^\d+$/).transform(Number).optional(),
  status: z.enum(['all', 'unclaimed', 'claimed', 'contacted']).optional(),
  sort_by: z.enum(['priority_score', 'created_at', 'company_name']).default('priority_score'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
})

const createProspectSchema = z.object({
  company_name: z.string().min(1),
  state: z.string().length(2),
  industry: z.enum([
    'restaurant',
    'retail',
    'construction',
    'healthcare',
    'manufacturing',
    'services',
    'technology'
  ]),
  lien_amount: z.number().positive().optional(),
  filing_date: z.string().datetime().optional()
})

const updateProspectSchema = createProspectSchema.partial()

const idParamSchema = z.object({
  id: z.string().uuid()
})

// A claiming user identifier. The dashboard sends a display name ('Current
// User') rather than a UUID, so this is a non-empty string, not z.uuid().
const claimBodySchema = z.object({
  user: z.string().min(1)
})

const MAX_BATCH_SIZE = 100

const batchClaimBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE),
  user: z.string().min(1)
})

const batchDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE)
})

type ProspectsQuery = z.infer<typeof querySchema>

const PROSPECT_TIER_LIMITS: Record<ResolvedDataTier, number> = {
  'free-tier': 20,
  'starter-tier': 100
}

const FREE_TIER_MIN_SCORE = 70

function applyProspectTierConstraints(
  query: ProspectsQuery,
  dataTier: ResolvedDataTier
): ProspectsQuery {
  const maxLimit = PROSPECT_TIER_LIMITS[dataTier]
  const limit = Math.min(query.limit, maxLimit)

  if (dataTier !== 'free-tier') {
    return { ...query, limit }
  }

  const minScore =
    query.min_score === undefined
      ? FREE_TIER_MIN_SCORE
      : Math.max(query.min_score, FREE_TIER_MIN_SCORE)

  return {
    ...query,
    limit,
    min_score: minScore
  }
}

// GET /api/prospects - List prospects (paginated, filtered, sorted)
router.get(
  '/',
  validateRequest({ query: querySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const dataTier = getResolvedDataTier(req)
    const tieredQuery = applyProspectTierConstraints(req.query as ProspectsQuery, dataTier)
    const result = await prospectsService.list(tieredQuery)

    res.json({
      prospects: result.prospects,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

// POST /api/prospects/batch/claim - Claim multiple prospects
//
// Registered before the parametrized `/:id` routes so the literal `batch`
// segment is matched here rather than being captured as an `:id` (which would
// fail UUID validation with a 400). Returns the claimed prospect rows so the
// client can patch its in-memory list.
router.post(
  '/batch/claim',
  validateRequest({ body: batchClaimBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const { ids, user } = req.body as { ids: string[]; user: string }
    const claimed = await prospectsService.batchClaimReturning(ids, user)

    res.json(claimed)
  })
)

// DELETE /api/prospects/batch - Delete multiple prospects
//
// Registered before `/:id` for the same routing-precedence reason as the batch
// claim route above.
router.delete(
  '/batch',
  validateRequest({ body: batchDeleteBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const { ids } = req.body as { ids: string[] }
    await prospectsService.batchDelete(ids)

    res.status(204).send()
  })
)

// GET /api/prospects/:id - Get prospect details
router.get(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.getById(req.params.id)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(prospect)
  })
)

// POST /api/prospects - Create prospect
router.post(
  '/',
  validateRequest({ body: createProspectSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.create(req.body)

    res.status(201).json(prospect)
  })
)

// POST /api/prospects/:id/claim - Claim a prospect for a user
//
// Sets status='claimed', claimed_by, claimed_date. The service performs an
// atomic conditional update; a NotFoundError (404) or ConflictError (409,
// already claimed) propagates to the error handler. Returns the claimed
// prospect row (the shape the dashboard expects).
router.post(
  '/:id/claim',
  validateRequest({ params: idParamSchema, body: claimBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const { user } = req.body as { user: string }
    const prospect = await prospectsService.claim(req.params.id, user)

    res.json(prospect)
  })
)

// POST /api/prospects/:id/unclaim - Release a claimed prospect
//
// Reverses claim: status='new', clears claimed_by/claimed_date. Returns the
// updated prospect row.
router.post(
  '/:id/unclaim',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.unclaim(req.params.id)

    res.json(prospect)
  })
)

// PATCH /api/prospects/:id - Update prospect
router.patch(
  '/:id',
  validateRequest({ params: idParamSchema, body: updateProspectSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.update(req.params.id, req.body)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(prospect)
  })
)

// DELETE /api/prospects/:id - Delete prospect
router.delete(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const deleted = await prospectsService.delete(req.params.id)

    if (!deleted) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.status(204).send()
  })
)

export default router
