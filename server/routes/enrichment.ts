import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { getResolvedDataTier } from '../middleware/dataTier'
import { EnrichmentService } from '../services/EnrichmentService'

const router = Router()

// Validation schemas (`.strict()` rejects unknown keys to prevent
// mass-assignment of unexpected fields into enrichment/job inputs).
const enrichProspectSchema = z.object({
  prospect_id: z.string().uuid()
}).strict()

const batchEnrichSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1).max(100)
}).strict()

const triggerRefreshSchema = z.object({
  force: z.boolean().default(false)
}).strict()

// POST /api/enrichment/prospect - Enrich single prospect
router.post(
  '/prospect',
  validateRequest({ body: enrichProspectSchema }),
  asyncHandler(async (req, res) => {
    const enrichmentService = new EnrichmentService()
    const dataTier = getResolvedDataTier(req)
    const result = await enrichmentService.enrichProspect(req.body.prospect_id, dataTier)

    res.json({
      prospect_id: req.body.prospect_id,
      enrichment: result,
      enriched_at: new Date().toISOString()
    })
  })
)

// POST /api/enrichment/batch - Batch enrich prospects
router.post(
  '/batch',
  validateRequest({ body: batchEnrichSchema }),
  asyncHandler(async (req, res) => {
    const enrichmentService = new EnrichmentService()
    const dataTier = getResolvedDataTier(req)
    const results = await enrichmentService.enrichBatch(req.body.prospect_ids, dataTier)

    res.json({
      total: req.body.prospect_ids.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results
    })
  })
)

// POST /api/enrichment/refresh - Trigger data refresh
router.post(
  '/refresh',
  validateRequest({ body: triggerRefreshSchema }),
  asyncHandler(async (req, res) => {
    const enrichmentService = new EnrichmentService()
    const dataTier = getResolvedDataTier(req)
    const result = await enrichmentService.triggerRefresh(req.body.force, dataTier)

    res.json({
      triggered: true,
      force: req.body.force,
      ...result
    })
  })
)

// GET /api/enrichment/status - Get enrichment pipeline status
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const enrichmentService = new EnrichmentService()
    const status = await enrichmentService.getStatus()

    res.json(status)
  })
)

// GET /api/enrichment/queue - Get enrichment queue status
router.get(
  '/queue',
  asyncHandler(async (req, res) => {
    const enrichmentService = new EnrichmentService()
    const queue = await enrichmentService.getQueueStatus()

    res.json(queue)
  })
)

export default router
