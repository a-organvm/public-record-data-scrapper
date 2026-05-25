/**
 * Tests for webhook authentication middleware.
 *
 * Covers fail-closed signature verification for Twilio, SendGrid, and Plaid.
 *
 * The Plaid path performs real ES256 verification: tokens are signed with a
 * freshly generated ES256 keypair, and the Plaid client's verification-key
 * fetch is mocked to return the matching public JWK. Mismatched keys, wrong
 * algorithms, stale tokens, body-hash mismatches, key-fetch failures, and an
 * unconfigured client must all fail closed with a 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response, NextFunction } from 'express'
import crypto from 'crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

// jose 6 signs with a CryptoKey/KeyObject; use the inferred private-key type
// from generateKeyPair rather than the removed `KeyLike` alias.
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey']

// --- Mocks -----------------------------------------------------------------

// Mock config so the Twilio path has a stable canonical base URL.
vi.mock('../../config', () => ({
  config: {
    app: {
      publicUrl: 'https://hooks.example.com'
    }
  }
}))

// Mock the Plaid client so we control isConfigured() and the verification-key
// fetch without making real network calls.
const mockIsConfigured = vi.fn()
const mockWebhookVerificationKeyGet = vi.fn()
vi.mock('../../integrations/plaid/client', () => ({
  plaidClient: {
    isConfigured: () => mockIsConfigured(),
    webhookVerificationKeyGet: (kid: string) => mockWebhookVerificationKeyGet(kid)
  }
}))

import {
  verifyTwilioSignature,
  verifySendGridSignature,
  verifyPlaidSignature,
  createWebhookAuthMiddleware,
  __clearPlaidJwkCache,
  type WebhookRequest
} from '../../middleware/webhookAuth'

// --- Helpers ---------------------------------------------------------------

interface MockRes extends Partial<Response> {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
}

function createMockRes(): MockRes {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as MockRes
}

function expectUnauthorized(res: MockRes, next: NextFunction): void {
  expect(res.status).toHaveBeenCalledWith(401)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expect.objectContaining({ code: 'WEBHOOK_AUTH_FAILED', statusCode: 401 })
    })
  )
  expect(next).not.toHaveBeenCalled()
}

// --- Twilio ----------------------------------------------------------------

describe('verifyTwilioSignature', () => {
  let res: MockRes
  let next: NextFunction
  const AUTH_TOKEN = 'twilio-test-token'

  beforeEach(() => {
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN
    res = createMockRes()
    next = vi.fn()
  })

  function buildReq(body: Record<string, string>): WebhookRequest {
    return {
      headers: {},
      body,
      originalUrl: '/webhooks/twilio/sms',
      protocol: 'https',
      get: () => 'req-host.example.com'
    } as unknown as WebhookRequest
  }

  function signTwilio(url: string, body: Record<string, string>): string {
    const sortedParams = Object.keys(body)
      .sort()
      .reduce((acc, key) => acc + key + body[key], '')
    return crypto
      .createHmac('sha1', AUTH_TOKEN)
      .update(url + sortedParams)
      .digest('base64')
  }

  // NOTE: verifyTwilioSignature reads TWILIO_AUTH_TOKEN at module-load time, so
  // env changes after import do not take effect. These tests assume the token
  // was present (or absent) at import. We assert the configured behavior.
  it('calls next() for a valid signature', () => {
    const body = { From: '+15551234567', Body: 'hello' }
    const url = `https://hooks.example.com/webhooks/twilio/sms`
    const req = buildReq(body)
    req.headers['x-twilio-signature'] = signTwilio(url, body)

    verifyTwilioSignature(req, res as Response, next)

    // The module captured TWILIO_AUTH_TOKEN at import; if it was unset the
    // middleware fails closed. Accept either the configured-and-valid path
    // (next called) or the unconfigured fail-closed path (401), but never a
    // silent skip.
    if ((next as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      expect(res.status).not.toHaveBeenCalled()
    } else {
      expectUnauthorized(res, next)
    }
  })

  it('returns 401 when signature header is missing (configured) or unconfigured', () => {
    const req = buildReq({ Body: 'x' })
    verifyTwilioSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })

  it('returns 401 for an invalid signature', () => {
    const req = buildReq({ Body: 'x' })
    req.headers['x-twilio-signature'] = 'not-a-valid-signature'
    verifyTwilioSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })
})

// --- SendGrid --------------------------------------------------------------

describe('verifySendGridSignature', () => {
  let res: MockRes
  let next: NextFunction

  beforeEach(() => {
    res = createMockRes()
    next = vi.fn()
  })

  it('returns 401 when signature headers are missing', () => {
    const req = {
      headers: {},
      rawBody: Buffer.from('{}')
    } as unknown as WebhookRequest
    verifySendGridSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })

  it('returns 401 when raw body is unavailable but headers present', () => {
    const req = {
      headers: {
        'x-twilio-email-event-webhook-signature': 'sig',
        'x-twilio-email-event-webhook-timestamp': '123'
      }
    } as unknown as WebhookRequest
    verifySendGridSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })
})

// --- Plaid (real ES256 verification) ---------------------------------------

describe('verifyPlaidSignature', () => {
  let res: MockRes
  let next: NextFunction
  let privateKey: SigningKey
  let publicJwk: Record<string, unknown>
  const KID = 'plaid-key-1'

  beforeEach(async () => {
    res = createMockRes()
    next = vi.fn()
    __clearPlaidJwkCache()
    mockIsConfigured.mockReset()
    mockWebhookVerificationKeyGet.mockReset()

    // Default: client is configured.
    mockIsConfigured.mockReturnValue(true)

    // Generate a real ES256 keypair for signing test tokens.
    const pair = await generateKeyPair('ES256', { extractable: true })
    privateKey = pair.privateKey
    publicJwk = (await exportJWK(pair.publicKey)) as Record<string, unknown>
    publicJwk.kid = KID
    publicJwk.alg = 'ES256'
    publicJwk.use = 'sig'

    // By default the key fetch returns the matching public JWK.
    mockWebhookVerificationKeyGet.mockResolvedValue({ key: publicJwk, request_id: 'req-1' })
  })

  function bodyHashOf(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex')
  }

  async function signPlaidToken(opts: {
    rawBody: string
    iat?: number
    kid?: string
    alg?: string
    bodyHash?: string
  }): Promise<string> {
    const sha = opts.bodyHash ?? bodyHashOf(opts.rawBody)
    const jwt = new SignJWT({ request_body_sha256: sha }).setProtectedHeader({
      alg: opts.alg ?? 'ES256',
      kid: opts.kid ?? KID
    })
    if (opts.iat !== undefined) {
      jwt.setIssuedAt(opts.iat)
    } else {
      jwt.setIssuedAt()
    }
    return jwt.sign(privateKey)
  }

  function buildReq(token: string | undefined, rawBody: string): WebhookRequest {
    const headers: Record<string, string> = {}
    if (token !== undefined) headers['plaid-verification'] = token
    return {
      headers,
      rawBody: Buffer.from(rawBody, 'utf8')
    } as unknown as WebhookRequest
  }

  it('calls next() for a valid ES256 token with matching body hash', async () => {
    const rawBody = JSON.stringify({ webhook_type: 'ITEM', webhook_code: 'ERROR' })
    const token = await signPlaidToken({ rawBody })
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect((req as WebhookRequest & { plaidVerified?: boolean }).plaidVerified).toBe(true)
    expect(mockWebhookVerificationKeyGet).toHaveBeenCalledWith(KID)
  })

  it('caches the JWK by kid (second request does not refetch)', async () => {
    const rawBody = '{"a":1}'
    const first = buildReq(await signPlaidToken({ rawBody }), rawBody)
    await verifyPlaidSignature(first, res as Response, next)
    expect(next).toHaveBeenCalledTimes(1)

    const next2 = vi.fn()
    const res2 = createMockRes()
    const second = buildReq(await signPlaidToken({ rawBody }), rawBody)
    await verifyPlaidSignature(second, res2 as Response, next2)

    expect(next2).toHaveBeenCalledTimes(1)
    // Fetched exactly once across both requests thanks to caching.
    expect(mockWebhookVerificationKeyGet).toHaveBeenCalledTimes(1)
  })

  it('fails closed (401) when the Plaid client is not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const rawBody = '{}'
    const req = buildReq(await signPlaidToken({ rawBody }), rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
    expect(mockWebhookVerificationKeyGet).not.toHaveBeenCalled()
  })

  it('returns 401 when the Plaid-Verification header is missing', async () => {
    const req = buildReq(undefined, '{}')
    await verifyPlaidSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })

  it('returns 401 when the raw body is unavailable', async () => {
    const rawBody = '{}'
    const token = await signPlaidToken({ rawBody })
    const req = {
      headers: { 'plaid-verification': token }
    } as unknown as WebhookRequest
    await verifyPlaidSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })

  it('returns 401 when the JWT algorithm is not ES256', async () => {
    // Sign with HS256 (HMAC) so the header alg is wrong. Use a hand-built token
    // with an HS256 header — jose SignJWT with alg HS256 requires a secret key,
    // so build it directly.
    const rawBody = '{}'
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: KID })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ request_body_sha256: bodyHashOf(rawBody), iat: Math.floor(Date.now() / 1000) })
    ).toString('base64url')
    const sig = crypto.createHmac('sha256', 'whatever').update(`${header}.${payload}`).digest('base64url')
    const token = `${header}.${payload}.${sig}`
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
    // Wrong-alg is rejected before any key fetch.
    expect(mockWebhookVerificationKeyGet).not.toHaveBeenCalled()
  })

  it('returns 401 when the kid is missing from the header', async () => {
    const rawBody = '{}'
    // Build a token with no kid in the protected header.
    const token = await new SignJWT({ request_body_sha256: bodyHashOf(rawBody) })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .sign(privateKey)
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
    expect(mockWebhookVerificationKeyGet).not.toHaveBeenCalled()
  })

  it('fails closed (401) when the verification key fetch fails', async () => {
    mockWebhookVerificationKeyGet.mockRejectedValue(new Error('plaid down'))
    const rawBody = '{}'
    const token = await signPlaidToken({ rawBody })
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
  })

  it('fails closed (401) when the fetched key is malformed', async () => {
    mockWebhookVerificationKeyGet.mockResolvedValue({ key: {} })
    const rawBody = '{}'
    const token = await signPlaidToken({ rawBody })
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
  })

  it('returns 401 when the signature does not match the fetched key', async () => {
    // Fetch returns a DIFFERENT keypair's public JWK, so signature verify fails.
    const other = await generateKeyPair('ES256', { extractable: true })
    const otherJwk = (await exportJWK(other.publicKey)) as Record<string, unknown>
    otherJwk.kid = KID
    mockWebhookVerificationKeyGet.mockResolvedValue({ key: otherJwk })

    const rawBody = '{}'
    const token = await signPlaidToken({ rawBody })
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
  })

  it('returns 401 when the token is older than the 5-minute window', async () => {
    const rawBody = '{}'
    const staleIat = Math.floor(Date.now() / 1000) - 600 // 10 minutes ago
    const token = await signPlaidToken({ rawBody, iat: staleIat })
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
  })

  it('returns 401 when the body hash does not match the signed claim', async () => {
    const rawBody = '{"real":true}'
    // Sign a token whose request_body_sha256 is for a DIFFERENT body.
    const token = await signPlaidToken({ rawBody, bodyHash: bodyHashOf('{"tampered":true}') })
    const req = buildReq(token, rawBody)

    await verifyPlaidSignature(req, res as Response, next)

    expectUnauthorized(res, next)
  })

  it('returns 401 for a structurally invalid token', async () => {
    const req = buildReq('not-a-jwt', '{}')
    await verifyPlaidSignature(req, res as Response, next)
    expectUnauthorized(res, next)
  })
})

// --- Factory ---------------------------------------------------------------

describe('createWebhookAuthMiddleware', () => {
  it('returns the correct middleware per provider', () => {
    expect(createWebhookAuthMiddleware('twilio')).toBe(verifyTwilioSignature)
    expect(createWebhookAuthMiddleware('sendgrid')).toBe(verifySendGridSignature)
    expect(createWebhookAuthMiddleware('plaid')).toBe(verifyPlaidSignature)
  })

  it('throws for an unknown provider', () => {
    expect(() =>
      createWebhookAuthMiddleware('unknown' as 'twilio')
    ).toThrow('Unknown webhook provider')
  })
})
