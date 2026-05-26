import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import {
  authMiddleware,
  optionalAuthMiddleware,
  requireRole,
  AuthenticatedRequest
} from '../../middleware/authMiddleware'

// Mock config
vi.mock('../../config', () => ({
  config: {
    jwt: {
      secret: 'test-secret',
      orgClaim: 'org_id',
      tierClaim: 'tier'
    }
  }
}))

describe('authMiddleware', () => {
  let mockReq: Partial<AuthenticatedRequest>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  const testSecret = 'test-secret'

  beforeEach(() => {
    mockReq = {
      headers: {}
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
    mockNext = vi.fn()
  })

  function createToken(payload: object, options?: jwt.SignOptions): string {
    return jwt.sign(payload, testSecret, options)
  }

  describe('authentication', () => {
    it('returns 401 when no authorization header', () => {
      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'No authorization header provided'
        })
      )
      expect(mockNext).not.toHaveBeenCalled()
    })

    it('returns 401 for invalid header format (no Bearer prefix)', () => {
      mockReq.headers = { authorization: 'InvalidFormat token123' }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid authorization header format. Expected: Bearer <token>'
        })
      )
    })

    it('returns 401 for malformed header (single part)', () => {
      mockReq.headers = { authorization: 'Bearer' }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
    })

    it('returns 401 for invalid token', () => {
      mockReq.headers = { authorization: 'Bearer invalid.token.here' }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid token'
        })
      )
    })

    it('returns 401 for expired token', () => {
      const expiredToken = createToken({ sub: 'user123' }, { expiresIn: '-1h' })
      mockReq.headers = { authorization: `Bearer ${expiredToken}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Token has expired'
        })
      )
    })

    it('authenticates valid token and adds user to request', () => {
      const validToken = createToken({
        sub: 'user123',
        email: 'user@example.com',
        role: 'admin'
      })
      mockReq.headers = { authorization: `Bearer ${validToken}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockReq.user).toEqual({
        id: 'user123',
        email: 'user@example.com',
        role: 'admin'
      })
    })

    it('handles token without optional fields', () => {
      const minimalToken = createToken({ sub: 'user456' })
      mockReq.headers = { authorization: `Bearer ${minimalToken}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockReq.user).toEqual({
        id: 'user456',
        email: undefined,
        role: undefined
      })
    })

    it('reads orgId from the plain org_id claim', () => {
      const token = createToken({ sub: 'user1', org_id: 'org-plain' })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockReq.user?.orgId).toBe('org-plain')
    })

    it('reads orgId from a namespaced Auth0 claim (/org_id)', () => {
      const token = createToken({
        sub: 'user1',
        'https://ucc-mca.example.com/org_id': 'org-namespaced'
      })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockReq.user?.orgId).toBe('org-namespaced')
    })

    it('reads orgId from a namespaced camelCase claim (/orgId)', () => {
      const token = createToken({
        sub: 'user1',
        'https://ucc-mca.example.com/orgId': 'org-camel'
      })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockReq.user?.orgId).toBe('org-camel')
    })

    it('prefers the plain claim over a namespaced one', () => {
      const token = createToken({
        sub: 'user1',
        org_id: 'org-plain',
        'https://ucc-mca.example.com/org_id': 'org-namespaced'
      })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockReq.user?.orgId).toBe('org-plain')
    })

    it('exposes tier from a plain tier claim', () => {
      const token = createToken({ sub: 'user1', tier: 'professional' })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockReq.user?.tier).toBe('professional')
    })

    it('exposes tier from a namespaced claim (/tier)', () => {
      const token = createToken({
        sub: 'user1',
        'https://ucc-mca.example.com/tier': 'enterprise'
      })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockReq.user?.tier).toBe('enterprise')
    })

    it('ignores non-string custom claim values (fails to undefined)', () => {
      const token = createToken({
        sub: 'user1',
        'https://ucc-mca.example.com/org_id': { nested: 'object' }
      })
      mockReq.headers = { authorization: `Bearer ${token}` }

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

      expect(mockReq.user?.orgId).toBeUndefined()
    })
  })
})

describe('optionalAuthMiddleware', () => {
  let mockReq: Partial<AuthenticatedRequest>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  const testSecret = 'test-secret'

  beforeEach(() => {
    mockReq = {
      headers: {}
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
    mockNext = vi.fn()
  })

  function createToken(payload: object): string {
    return jwt.sign(payload, testSecret)
  }

  it('calls next without error when no auth header', () => {
    optionalAuthMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockReq.user).toBeUndefined()
  })

  it('calls next without error for invalid token format', () => {
    mockReq.headers = { authorization: 'InvalidFormat' }

    optionalAuthMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockReq.user).toBeUndefined()
  })

  it('ignores invalid tokens silently', () => {
    mockReq.headers = { authorization: 'Bearer invalid.token' }

    optionalAuthMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockReq.user).toBeUndefined()
    expect(mockRes.status).not.toHaveBeenCalled()
  })

  it('adds user when valid token provided', () => {
    const token = createToken({ sub: 'user789', email: 'test@test.com' })
    mockReq.headers = { authorization: `Bearer ${token}` }

    optionalAuthMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockReq.user).toEqual({
      id: 'user789',
      email: 'test@test.com',
      role: undefined
    })
  })

  it('resolves namespaced org and tier claims for optional auth', () => {
    const token = createToken({
      sub: 'user789',
      'https://ucc-mca.example.com/org_id': 'org-optional',
      'https://ucc-mca.example.com/tier': 'starter'
    })
    mockReq.headers = { authorization: `Bearer ${token}` }

    optionalAuthMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockReq.user?.orgId).toBe('org-optional')
    expect(mockReq.user?.tier).toBe('starter')
  })
})

describe('requireRole middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    mockReq = {}
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
    mockNext = vi.fn()
  })

  it('returns 401 when user is not authenticated', () => {
    const middleware = requireRole('admin')
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(401)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unauthorized',
        message: 'Authentication required'
      })
    )
  })

  it('returns 403 when user has no role', () => {
    mockReq.user = { id: 'user1' }

    const middleware = requireRole('admin')
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(403)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      })
    )
  })

  it('returns 403 when user role is not in allowed list', () => {
    mockReq.user = { id: 'user1', role: 'user' }

    const middleware = requireRole('admin', 'superadmin')
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(403)
  })

  it('calls next when user has allowed role', () => {
    mockReq.user = { id: 'user1', role: 'admin' }

    const middleware = requireRole('admin', 'superadmin')
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockRes.status).not.toHaveBeenCalled()
  })

  it('works with single allowed role', () => {
    mockReq.user = { id: 'user1', role: 'editor' }

    const middleware = requireRole('editor')
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('works with multiple allowed roles', () => {
    mockReq.user = { id: 'user1', role: 'viewer' }

    const middleware = requireRole('admin', 'editor', 'viewer')
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })
})
