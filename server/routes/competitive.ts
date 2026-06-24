import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { CompetitiveHeatMapService } from '../services/CompetitiveHeatMapService'
import { FilingVelocityService } from '../services/FilingVelocityService'
import { FreshCapacityService } from '../services/FreshCapacityService'
import { database } from '../database/connection'

const router = Router()

const stateParam = z.object({
  state: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
})

const funderNameParam = z.object({
  name: z.string().min(1).max(200)
})

const prospectIdParam = z.object({
  prospectId: z.string().min(1).max(100)
})

const recentEventsQuery = z.object({
  hours: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Math.min(Math.max(Number(v), 1), 24 * 90))
    .default('168')
})

const acceleratingQuery = z.object({
  state: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
    .optional()
})

// GET /api/competitive/saturation/:state — market saturation + HHI for a state
router.get('/saturation/:state', validateRequest({ params: stateParam }), async (req, res) => {
  try {
    const service = new CompetitiveHeatMapService(database)
    const saturation = await service.getCompetitiveSaturation(
      req.params.state,
      req.query.industry as string | undefined
    )
    res.json(saturation)
  } catch (err) {
    console.error('[competitive] Saturation error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to compute saturation' })
  }
})

// GET /api/competitive/funder/:name — geographic heat map for a funder
router.get('/funder/:name', validateRequest({ params: funderNameParam }), async (req, res) => {
  try {
    const { name } = req.params
    const service = new CompetitiveHeatMapService(database)
    const heatMap = await service.getGeographicHeatMap(name)
    res.json({ funder: name, states: heatMap })
  } catch (err) {
    console.error('[competitive] Funder heatmap error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to get funder heat map' })
  }
})

// GET /api/competitive/events/recent — recent filing events
router.get('/events/recent', validateRequest({ query: recentEventsQuery }), async (req, res) => {
  try {
    const hours = req.query.hours
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
  } catch (err) {
    console.error('[competitive] Events error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to get recent events' })
  }
})

// GET /api/competitive/velocity/:prospectId — velocity metrics for a prospect
router.get(
  '/velocity/:prospectId',
  validateRequest({ params: prospectIdParam }),
  async (req, res) => {
    try {
      const velocityService = new FilingVelocityService(database)
      const metrics = await velocityService.computeVelocity(req.params.prospectId)
      res.json({ prospectId: req.params.prospectId, metrics })
    } catch (err) {
      console.error('[competitive] Velocity error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to compute velocity' })
    }
  }
)

// GET /api/competitive/capacity/:prospectId — fresh capacity score
router.get(
  '/capacity/:prospectId',
  validateRequest({ params: prospectIdParam }),
  async (req, res) => {
    try {
      const capacityService = new FreshCapacityService(database)
      const result = await capacityService.computeForProspect(req.params.prospectId)
      res.json({ prospectId: req.params.prospectId, ...result })
    } catch (err) {
      console.error('[competitive] Capacity error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to compute capacity' })
    }
  }
)

// GET /api/competitive/accelerating — prospects with accelerating filing velocity
router.get('/accelerating', validateRequest({ query: acceleratingQuery }), async (req, res) => {
  try {
    const state = req.query.state
    const velocityService = new FilingVelocityService(database)
    const prospects = await velocityService.detectAccelerating(state)
    res.json({ prospects, count: prospects.length })
  } catch (err) {
    console.error('[competitive] Accelerating error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to detect accelerating prospects' })
  }
})

export default router
