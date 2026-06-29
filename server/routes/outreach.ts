import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { NotFoundError } from '../errors'
import { PreCallBriefingService } from '../services/PreCallBriefingService'
import { OutreachSequenceService } from '../services/OutreachSequenceService'
import { narrativeService } from '../services/NarrativeService'
import { database } from '../database/connection'

const router = Router()

const prospectIdParamSchema = z
  .object({
    prospectId: z.string().uuid()
  })
  .strict()

const sequenceIdParamSchema = z
  .object({
    id: z.string().uuid()
  })
  .strict()

const triggerBodySchema = z
  .object({
    triggerType: z.enum(['termination', 'new_filing', 'acceleration']).default('termination'),
    capacityScore: z.number().min(0).max(100).optional()
  })
  .strict()

// GET /api/outreach/briefing/:prospectId — Generate/return pre-call briefing
router.get(
  '/briefing/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  asyncHandler(async (req, res) => {
    const service = new PreCallBriefingService(database)
    const cached = await service.getCachedBriefing(req.params.prospectId)
    if (cached) return res.json(cached)
    try {
      const briefing = await service.generateBriefing(req.params.prospectId)
      res.json(briefing)
    } catch (err) {
      if ((err as Error).message?.includes('not found')) {
        throw new NotFoundError('Prospect', req.params.prospectId)
      }
      throw err
    }
  })
)

// GET /api/outreach/narrative/:prospectId — Generate sales narrative
router.get(
  '/narrative/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  asyncHandler(async (req, res) => {
    try {
      const narrative = await narrativeService.generateNarrative(req.params.prospectId)
      res.json(narrative)
    } catch (err) {
      if ((err as Error).message?.includes('not found')) {
        throw new NotFoundError('Prospect', req.params.prospectId)
      }
      throw err
    }
  })
)

// POST /api/outreach/trigger/:prospectId — Manually trigger outreach
router.post(
  '/trigger/:prospectId',
  validateRequest({ params: prospectIdParamSchema, body: triggerBodySchema }),
  asyncHandler(async (req, res) => {
    const { triggerType, capacityScore } = req.body as z.infer<typeof triggerBodySchema>
    const sequenceService = new OutreachSequenceService(database)

    const eligibility = await sequenceService.isEligible(
      req.params.prospectId,
      triggerType,
      capacityScore
    )
    if (!eligibility.eligible) {
      return res.status(409).json({ error: 'Not eligible', reason: eligibility.reason })
    }

    const sequenceId = await sequenceService.createSequence(
      req.params.prospectId,
      triggerType,
      undefined,
      capacityScore
    )
    res.status(201).json({ sequenceId, status: 'created' })
  })
)

// GET /api/outreach/sequences/:prospectId — List active sequences
router.get(
  '/sequences/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  asyncHandler(async (req, res) => {
    const service = new OutreachSequenceService(database)
    const sequences = await service.getActiveSequences(req.params.prospectId)
    res.json({ sequences, count: sequences.length })
  })
)

// POST /api/outreach/sequences/:id/cancel — Cancel a sequence
router.post(
  '/sequences/:id/cancel',
  validateRequest({ params: sequenceIdParamSchema }),
  asyncHandler(async (req, res) => {
    const service = new OutreachSequenceService(database)
    await service.cancelSequence(req.params.id)
    res.json({ status: 'cancelled' })
  })
)

export default router
