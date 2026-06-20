import { describe, it, expect, beforeEach, vi } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import authRouter from '../../routes/auth'
import { authMiddleware, type AuthenticatedRequest } from '../../middleware/authMiddleware'

vi.mock('../../config', () => ({
  config: {
    jwt: {
      secret: 'test-jwt-secret',
      issuer: 'ucc-test',
      audience: 'ucc-customers',
      orgClaim: 'org_id',
      tierClaim: 'tier',
      apiKeyExpiresIn: '7d'
    },
    auth: {
      apiKeyIssuerSecret: 'issuer-secret'
    }
  }
}))

describe('Auth API', () => {
  let app: Express

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use('/api/auth', authRouter)
    app.get('/api/protected', authMiddleware, (req: AuthenticatedRequest, res) => {
      res.json({ user: req.user })
    })
  })

  it('rejects API key issuance without the issuer secret', async () => {
    const response = await request(app).post('/api/auth/api-keys').send({
      userId: 'user-1',
      orgId: 'org-1'
    })

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      message: 'Valid X-API-Key-Issuer-Secret header required'
    })
  })

  it('validates API key issuance input after the issuer secret passes', async () => {
    const response = await request(app)
      .post('/api/auth/api-keys')
      .set('X-API-Key-Issuer-Secret', 'issuer-secret')
      .send({
        userId: 'user-1'
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('issues a signed API key with tenant and user claims', async () => {
    const response = await request(app)
      .post('/api/auth/api-keys')
      .set('X-API-Key-Issuer-Secret', 'issuer-secret')
      .send({
        userId: 'user-1',
        orgId: 'org-1',
        email: 'user@example.com',
        role: 'admin',
        tier: 'starter-tier',
        expiresIn: '1h'
      })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      apiKey: expect.any(String),
      keyId: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: '1h',
      expiresAt: expect.any(String),
      user: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'admin',
        orgId: 'org-1',
        tier: 'starter-tier'
      }
    })

    const decoded = jwt.verify(response.body.apiKey, 'test-jwt-secret', {
      algorithms: ['HS256'],
      issuer: 'ucc-test',
      audience: 'ucc-customers'
    }) as jwt.JwtPayload

    expect(decoded).toMatchObject({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'admin',
      org_id: 'org-1',
      tier: 'starter-tier',
      token_use: 'api_key',
      jti: response.body.keyId
    })
  })

  it('verifies an issued API key on protected endpoints via X-API-Key', async () => {
    const issued = await request(app)
      .post('/api/auth/api-keys')
      .set('X-API-Key-Issuer-Secret', 'issuer-secret')
      .send({
        userId: 'user-2',
        orgId: 'org-2',
        role: 'viewer'
      })

    const response = await request(app)
      .get('/api/protected')
      .set('X-API-Key', issued.body.apiKey)

    expect(response.status).toBe(200)
    expect(response.body.user).toMatchObject({
      id: 'user-2',
      role: 'viewer',
      orgId: 'org-2'
    })
  })
})
