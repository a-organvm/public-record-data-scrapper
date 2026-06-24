import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Response, NextFunction } from 'express'

// Mock the JWT auth middleware so we can assert delegation without real tokens.
vi.mock('../../middleware/authMiddleware', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next())
}))

// Mock ApiKeyService.verify. Use a method (not an instance field) that defers
// to the hoisted mock at call time — apiKeyAuth.ts constructs ApiKeyService at
// module load, before `verifyMock` would be initialized for a field initializer.
const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }))
vi.mock('../../services/ApiKeyService', () => ({
  API_KEY_PREFIX: 'prk_',
  ApiKeyService: class {
    verify(...args: unknown[]) {
      return verifyMock(...args)
    }
  }
}))

import { apiKeyOrJwtAuth, extractApiKey } from '../../middleware/apiKeyAuth'
import { authMiddleware, type AuthenticatedRequest } from '../../middleware/authMiddleware'

const authMiddlewareMock = vi.mocked(authMiddleware)

function makeReq(headers: Record<string, string> = {}): AuthenticatedRequest {
  return { headers } as unknown as AuthenticatedRequest
}

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown }
  res.status = vi.fn((code: number) => {
    res.statusCode = code
    return res
  }) as unknown as Response['status']
  res.json = vi.fn((payload: unknown) => {
    res.body = payload
    return res
  }) as unknown as Response['json']
  return res
}

describe('extractApiKey', () => {
  it('reads X-API-Key header', () => {
    expect(extractApiKey(makeReq({ 'x-api-key': 'prk_abc' }))).toBe('prk_abc')
  })

  it('reads a prk_-prefixed Bearer token', () => {
    expect(extractApiKey(makeReq({ authorization: 'Bearer prk_xyz' }))).toBe('prk_xyz')
  })

  it('ignores a JWT Bearer token (no prk_ prefix)', () => {
    expect(extractApiKey(makeReq({ authorization: 'Bearer eyJhbGci.jwt' }))).toBeUndefined()
  })

  it('returns undefined when no key is present', () => {
    expect(extractApiKey(makeReq())).toBeUndefined()
  })
})

describe('apiKeyOrJwtAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to JWT auth when no API key is present', async () => {
    const req = makeReq({ authorization: 'Bearer somejwt' })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await apiKeyOrJwtAuth(req, res, next)

    expect(authMiddlewareMock).toHaveBeenCalledTimes(1)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('populates req.user and authMethod for a valid API key', async () => {
    verifyMock.mockResolvedValueOnce({ keyId: 'key-1', orgId: 'org-7', role: 'user' })
    const req = makeReq({ 'x-api-key': 'prk_valid' })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await apiKeyOrJwtAuth(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(authMiddlewareMock).not.toHaveBeenCalled()
    expect(req.user).toEqual({ id: 'apikey:key-1', orgId: 'org-7', role: 'user' })
    expect(req.authMethod).toBe('api_key')
  })

  it('returns 401 for an invalid API key (no JWT fall-through)', async () => {
    verifyMock.mockResolvedValueOnce(null)
    const req = makeReq({ 'x-api-key': 'prk_bad' })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await apiKeyOrJwtAuth(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
    expect(authMiddlewareMock).not.toHaveBeenCalled()
  })

  it('returns 401 when verification throws', async () => {
    verifyMock.mockRejectedValueOnce(new Error('db down'))
    const req = makeReq({ 'x-api-key': 'prk_boom' })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await apiKeyOrJwtAuth(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
