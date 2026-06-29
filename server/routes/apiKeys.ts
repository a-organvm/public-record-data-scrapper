/**
 * API Key Management Routes
 *
 * Lets an organization admin mint, list, and revoke the API keys that paying
 * customers use to call the data-as-a-service scrape endpoints. These routes
 * are JWT + admin only (mounted behind authMiddleware + requireRole('admin') in
 * server/index.ts) so an API key can never mint or manage other keys.
 *
 *   POST   /api/keys      create a key (returns the plaintext key ONCE)
 *   GET    /api/keys      list the org's keys (metadata only, never secrets)
 *   DELETE /api/keys/:id  revoke a key
 *
 * @module server/routes/apiKeys
 */

import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import type { AuthenticatedRequest } from '../middleware/authMiddleware'
import { ApiKeyService } from '../services/ApiKeyService'

const router = Router()
const apiKeyService = new ApiKeyService()

const createKeySchema = z
  .object({
    name: z.string().min(1).max(120),
    role: z.enum(['user', 'admin']).default('user'),
    // Optional ISO-8601 expiry; rejected if not a valid future-or-any date string.
    expires_at: z.string().datetime().optional()
  })
  .strict()

const keyIdParamSchema = z
  .object({
    id: z.string().uuid()
  })
  .strict()

// POST /api/keys - mint a new API key for the caller's org
router.post(
  '/',
  validateRequest({ body: createKeySchema }),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const orgId = req.user?.orgId
    if (!orgId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No organization context on the authenticated session'
      })
    }

    const body = req.body as z.infer<typeof createKeySchema>
    const created = await apiKeyService.create({
      orgId,
      name: body.name,
      role: body.role,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      createdBy: req.user?.id
    })

    // The plaintext `key` is returned ONCE here and never again.
    res.status(201).json({
      success: true,
      data: created,
      meta: {
        notice: 'Store this key securely — it is shown only once and cannot be retrieved later.'
      }
    })
  })
)

// GET /api/keys - list the org's keys (metadata only)
router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const orgId = req.user?.orgId
    if (!orgId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No organization context on the authenticated session'
      })
    }

    const keys = await apiKeyService.list(orgId)
    res.json({ success: true, data: keys })
  })
)

// DELETE /api/keys/:id - revoke a key
router.delete(
  '/:id',
  validateRequest({ params: keyIdParamSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const orgId = req.user?.orgId
    if (!orgId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No organization context on the authenticated session'
      })
    }

    const revoked = await apiKeyService.revoke(orgId, req.params.id)
    if (!revoked) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'API key not found'
      })
    }

    res.json({ success: true, data: { id: req.params.id, revoked: true } })
  })
)

export default router
