import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { Router, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { config } from '../config'
import { validateRequest } from '../middleware/validateRequest'
import type { AuthenticatedRequest } from '../middleware/authMiddleware'

const router = Router()

const issueApiKeySchema = z.object({
  userId: z.string().min(1).max(128),
  orgId: z.string().min(1).max(128),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user', 'viewer']).default('user'),
  tier: z.string().min(1).max(64).optional(),
  expiresIn: z
    .string()
    .regex(/^\d+[smhd]$/, 'expiresIn must use a duration such as 1h, 7d, or 30d')
    .optional()
})

type IssueApiKeyBody = z.infer<typeof issueApiKeySchema>

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function constantTimeEqualString(a: string, b: string): boolean {
  const aDigest = createHash('sha256').update(a).digest()
  const bDigest = createHash('sha256').update(b).digest()
  return timingSafeEqual(aDigest, bDigest)
}

function getIssuerSecret(req: AuthenticatedRequest): string | undefined {
  return firstHeaderValue(req.headers['x-api-key-issuer-secret'])?.trim()
}

export function requireApiKeyIssuerSecret(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!config.jwt.secret || !config.auth.apiKeyIssuerSecret) {
    return res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'API key issuance is not configured'
    })
  }

  const presentedSecret = getIssuerSecret(req)
  const secretMatches =
    presentedSecret &&
    constantTimeEqualString(presentedSecret, config.auth.apiKeyIssuerSecret)

  if (!secretMatches) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid X-API-Key-Issuer-Secret header required'
    })
  }

  next()
}

router.post(
  '/api-keys',
  requireApiKeyIssuerSecret,
  validateRequest({ body: issueApiKeySchema }),
  (req, res) => {
    const body = req.body as IssueApiKeyBody
    const expiresIn = body.expiresIn || config.jwt.apiKeyExpiresIn
    const keyId = randomUUID()
    const payload: Record<string, unknown> = {
      email: body.email,
      role: body.role,
      org_id: body.orgId,
      token_use: 'api_key'
    }

    if (body.tier) {
      payload.tier = body.tier
    }

    const signOptions: jwt.SignOptions = {
      algorithm: 'HS256',
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
      jwtid: keyId,
      subject: body.userId
    }

    if (config.jwt.issuer) {
      signOptions.issuer = config.jwt.issuer
    }
    if (config.jwt.audience) {
      signOptions.audience = config.jwt.audience
    }

    const apiKey = jwt.sign(payload, config.jwt.secret, signOptions)
    const decoded = jwt.decode(apiKey) as { exp?: number } | null

    res.status(201).json({
      apiKey,
      keyId,
      tokenType: 'Bearer',
      expiresIn,
      expiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
      user: {
        id: body.userId,
        email: body.email,
        role: body.role,
        orgId: body.orgId,
        tier: body.tier
      }
    })
  }
)

export default router
