/**
 * API-key authentication middleware.
 *
 * Lets a paying customer authenticate to the data-as-a-service scrape endpoints
 * with a long-lived API key instead of an interactive JWT. A key may be sent as
 * either:
 *   - `X-API-Key: prk_…`
 *   - `Authorization: Bearer prk_…`  (the `prk_` prefix distinguishes it from a JWT)
 *
 * When a key is present it is verified against the api_keys table and, on
 * success, populates `req.user` (id/orgId/role) exactly like JWT auth — so the
 * downstream orgContext + requireRole machinery works unchanged. When no API
 * key is present the request falls through to the standard JWT auth middleware,
 * so existing dashboard/JWT callers keep working on the same routes.
 *
 * @module server/middleware/apiKeyAuth
 */

import { Response, NextFunction } from 'express'
import { authMiddleware, type AuthenticatedRequest } from './authMiddleware'
import { ApiKeyService, API_KEY_PREFIX } from '../services/ApiKeyService'

const apiKeyService = new ApiKeyService()

/**
 * Pull an API key out of the request, supporting both the dedicated
 * `X-API-Key` header and an `Authorization: Bearer prk_…` token. Returns
 * undefined when neither carries an API key.
 */
export function extractApiKey(req: AuthenticatedRequest): string | undefined {
  const headerKey = req.headers['x-api-key']
  if (typeof headerKey === 'string' && headerKey.length > 0) {
    return headerKey.trim()
  }

  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string') {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1].startsWith(API_KEY_PREFIX)) {
      return parts[1]
    }
  }

  return undefined
}

/**
 * Authenticate with an API key if one is presented, otherwise fall back to JWT.
 *
 * - API key present + valid   → req.user populated, req.authMethod = 'api_key'
 * - API key present + invalid → 401 (does NOT silently fall through to JWT, so a
 *   bad key can't be probed against the JWT path)
 * - No API key                → delegates to authMiddleware (JWT)
 */
export const apiKeyOrJwtAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const presentedKey = extractApiKey(req)

  if (!presentedKey) {
    authMiddleware(req, res, next)
    return
  }

  try {
    const verified = await apiKeyService.verify(presentedKey)
    if (!verified) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired API key'
      })
      return
    }

    req.user = {
      id: `apikey:${verified.keyId}`,
      orgId: verified.orgId,
      role: verified.role
    }
    req.authMethod = 'api_key'
    next()
  } catch {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'API key verification failed'
    })
  }
}
