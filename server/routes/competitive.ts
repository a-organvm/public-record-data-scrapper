import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { CompetitiveHeatMapService } from '../services/CompetitiveHeatMapService'
import { FilingVelocityService } from '../services/FilingVelocityService'
import { FreshCapacityService } from '../services/FreshCapacityService'
import { database } from '../database/connection'

const router = Router()

const stateParamSchema = z.object({
  state: z.string().length(2).transform((s) => s.toUpperCase())
})

const funderParamSchema = z.object({
  name: z.string().min(1).max(200)
})

const prospectIdParamSchema = z.object({
  prospectId: z.string().uuid()
})

const saturationQuerySchema = z.object({
  industry: z.string().min(1).max(100).optional()
})

const eventsQuerySchema = z.object({
  hours: z.coerce.number().int().positive().max(24 * 90).default(168)
})

const acceleratingQuerySchema = z.object({
  state: z.string().length(2).transform((s) => s.toUpperCase()).optional()
})

// GET /api/competitive/saturation/:state — market saturation + HHI for a state
router.get(
  '/saturation/:state',
  validateRequest({ params: stateParamSchema, query: saturationQuerySchema }),
  asyncHandler(async (req, res) => {
    const service = new CompetitiveHeatMapService(database)
    const saturation = await service.getCompetitiveSaturation(
      req.params.state,
      (req.query as z.infer<typeof saturationQuerySchema>).industry
    )
    res.json(saturation)
  })
)

// GET /api/competitive/funder/:name — geographic heat map for a funder
router.get(
  '/funder/:name',
  validateRequest({ params: funderParamSchema }),
  asyncHandler(async (req, res) => {
    const { name } = req.params
    const service = new CompetitiveHeatMapService(database)
    const heatMap = await service.getGeographicHeatMap(name)
    res.json({ funder: name, states: heatMap })
  })
)

// GET /api/competitive/events/recent — recent filing events
router.get(
  '/events/recent',
  validateRequest({ query: eventsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { hours } = req.query as z.infer<typeof eventsQuerySchema>
    const events = await database.query(
      `SELECT id, prospect_id as "prospectId", event_type as "eventType",
              filing_id as "filingId", event_date as "eventDate",
              metadata, created_at as "createdAt"
       FROM filing_events
       WHERE created_at >= NOW() - $1::integer * INTERVAL '1 hour'
       ORDER BY created_at DESC
       LIMIT 100`,
      [hours]
    )
    res.json({ events, count: events.length })
  })
)

// GET /api/competitive/velocity/:prospectId — velocity metrics for a prospect
router.get(
  '/velocity/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { prospectId } = req.params
    const velocityService = new FilingVelocityService(database)
    const metrics = await velocityService.computeVelocity(prospectId)
    res.json({ prospectId, metrics })
  })
)

// GET /api/competitive/capacity/:prospectId — fresh capacity score
router.get(
  '/capacity/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { prospectId } = req.params
    const capacityService = new FreshCapacityService(database)
    const result = await capacityService.computeForProspect(prospectId)
    res.json({ prospectId, ...result })
  })
)

// GET /api/competitive/accelerating — prospects with accelerating filing velocity
router.get(
  '/accelerating',
  validateRequest({ query: acceleratingQuerySchema }),
  asyncHandler(async (req, res) => {
    const { state } = req.query as z.infer<typeof acceleratingQuerySchema>
    const velocityService = new FilingVelocityService(database)
    const prospects = await velocityService.detectAccelerating(state)
    res.json({ prospects, count: prospects.length })
  })
)

export default router
