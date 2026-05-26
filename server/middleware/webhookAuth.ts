/**
 * Webhook Authentication Middleware
 *
 * Provides signature verification for incoming webhooks from:
 * - Twilio (SMS and Voice)
 * - SendGrid (Email events)
 * - Plaid (Transaction and Item updates)
 *
 * Each service has its own signature verification method to ensure
 * requests are authentic and haven't been tampered with.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express'
import crypto from 'crypto'
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import { config } from '../config'
import { plaidClient, type PlaidJWK } from '../integrations/plaid/client'

// Configuration from environment
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const SENDGRID_WEBHOOK_VERIFICATION_KEY = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY || ''

/**
 * In-process cache of Plaid webhook verification keys (JWKs) keyed by `kid`.
 *
 * Plaid rotates these keys, but a given `kid` maps to a stable public key for
 * its lifetime, so caching avoids fetching the JWK on every webhook. Misses
 * trigger a fresh fetch via the Plaid client.
 */
const plaidJwkCache = new Map<string, PlaidJWK>()

/**
 * Test-only hook to clear the cached Plaid JWKs between cases. Not used in
 * production flow.
 */
export function __clearPlaidJwkCache(): void {
  plaidJwkCache.clear()
}

/**
 * Extended request with raw body for signature verification
 */
export interface WebhookRequest extends Request {
  rawBody?: Buffer
}

/**
 * Standard 401 fail-closed response for webhook auth failures.
 */
function webhookUnauthorized(res: Response, message: string): Response {
  return res.status(401).json({
    error: {
      message,
      code: 'WEBHOOK_AUTH_FAILED',
      statusCode: 401
    }
  })
}

/**
 * Twilio Signature Verification
 *
 * Validates incoming Twilio webhooks using the X-Twilio-Signature header.
 * The signature is an HMAC-SHA1 hash of the request URL and sorted POST parameters.
 *
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
export const verifyTwilioSignature: RequestHandler = (
  req: WebhookRequest,
  res: Response,
  next: NextFunction
) => {
  // FAIL CLOSED: never accept a Twilio webhook when no auth token is configured.
  if (!TWILIO_AUTH_TOKEN) {
    console.error('[webhookAuth] Twilio auth token not configured - rejecting webhook')
    return webhookUnauthorized(res, 'Twilio webhook verification not configured')
  }

  const signature = req.headers['x-twilio-signature'] as string
  if (!signature) {
    console.error('[webhookAuth] Missing X-Twilio-Signature header')
    return webhookUnauthorized(res, 'Missing Twilio signature')
  }

  // Build the full URL. Use the configured canonical public URL as the base so
  // the signed URL is NOT derived from the attacker-controlled Host /
  // X-Forwarded-* headers (Twilio signs the exact URL it was configured with).
  // Falls back to req.protocol/req.host (Express-derived, honoring trust proxy)
  // only when no canonical URL is configured.
  let baseUrl: string
  if (config.app.publicUrl) {
    baseUrl = config.app.publicUrl.replace(/\/+$/, '')
  } else {
    // TODO(security): set PUBLIC_URL/APP_URL so Twilio signature verification
    // does not rely on request-derived host. req.host honors `trust proxy`.
    baseUrl = `${req.protocol}://${req.get('host') || ''}`
  }
  const url = `${baseUrl}${req.originalUrl}`

  // Twilio signs the URL plus the sorted POST parameters. Twilio sends
  // application/x-www-form-urlencoded, so req.body holds the parsed params.
  const sortedParams = Object.keys(req.body || {})
    .sort()
    .reduce((acc, key) => acc + key + req.body[key], '')

  // Create HMAC-SHA1 hash
  const data = url + sortedParams
  const expectedSignature = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(data)
    .digest('base64')

  // Timing-safe comparison to prevent timing attacks
  if (!timingSafeEqual(signature, expectedSignature)) {
    console.error('[webhookAuth] Invalid Twilio signature')
    return webhookUnauthorized(res, 'Invalid Twilio signature')
  }

  next()
}

/**
 * SendGrid Event Webhook Verification
 *
 * Validates incoming SendGrid event webhooks using ECDSA signature verification.
 * SendGrid signs the raw request body with their private key.
 *
 * @see https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
export const verifySendGridSignature: RequestHandler = (
  req: WebhookRequest,
  res: Response,
  next: NextFunction
) => {
  // FAIL CLOSED: never accept a SendGrid webhook when no verification key is set.
  if (!SENDGRID_WEBHOOK_VERIFICATION_KEY) {
    console.error('[webhookAuth] SendGrid verification key not configured - rejecting webhook')
    return webhookUnauthorized(res, 'SendGrid webhook verification not configured')
  }

  const signature = req.headers['x-twilio-email-event-webhook-signature'] as string
  const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'] as string

  if (!signature || !timestamp) {
    console.error('[webhookAuth] Missing SendGrid signature headers')
    return webhookUnauthorized(res, 'Missing SendGrid signature')
  }

  // Require the RAW body for signature verification. JSON.stringify(req.body)
  // is NOT byte-identical to what SendGrid signed (key order/whitespace), so a
  // re-serialized fallback would make verification meaningless. Fail closed.
  if (!req.rawBody) {
    console.error('[webhookAuth] SendGrid raw body unavailable - cannot verify signature')
    return webhookUnauthorized(res, 'SendGrid raw body unavailable for verification')
  }
  const rawBody = req.rawBody.toString('utf8')

  // Construct the payload to verify (timestamp + payload)
  const payload = timestamp + rawBody

  try {
    // Verify ECDSA signature
    const verifier = crypto.createVerify('sha256')
    verifier.update(payload)

    // Convert base64-encoded public key
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${SENDGRID_WEBHOOK_VERIFICATION_KEY}\n-----END PUBLIC KEY-----`

    const isValid = verifier.verify(publicKey, signature, 'base64')

    if (!isValid) {
      console.error('[webhookAuth] Invalid SendGrid signature')
      return webhookUnauthorized(res, 'Invalid SendGrid signature')
    }

    next()
  } catch (error) {
    console.error('[webhookAuth] SendGrid signature verification error:', error)
    return webhookUnauthorized(res, 'SendGrid signature verification failed')
  }
}

/**
 * Resolve the Plaid webhook verification key (JWK) for a given `kid`, using an
 * in-process cache and falling back to a live fetch via the Plaid client.
 *
 * @throws if the fetch fails or returns no usable key — callers fail closed.
 */
async function getPlaidVerificationKey(kid: string): Promise<PlaidJWK> {
  const cached = plaidJwkCache.get(kid)
  if (cached) {
    return cached
  }

  const response = await plaidClient.webhookVerificationKeyGet(kid)
  const key = response?.key
  if (!key || typeof key !== 'object' || !key.kty) {
    throw new Error(`Plaid verification key for kid "${kid}" missing or malformed`)
  }

  plaidJwkCache.set(kid, key)
  return key
}

/**
 * Plaid Webhook Verification
 *
 * Validates incoming Plaid webhooks using real ES256 JWT verification.
 * Plaid sends a signed JWT in the Plaid-Verification header. The flow is:
 *   1. Decode the JWT protected header to read `kid` and `alg`. Reject unless
 *      `alg === 'ES256'` and a `kid` is present.
 *   2. Fetch the public verification key (JWK) for that `kid` via Plaid's
 *      /webhook_verification_key/get endpoint (cached in-process by `kid`).
 *   3. Import the JWK and verify the compact JWT signature, pinned to ES256.
 *   4. Enforce the issued-at freshness window (<= 5 minutes) and confirm the
 *      raw request body hash matches the signed `request_body_sha256` claim.
 *
 * Any failure (unconfigured client, missing/invalid header, wrong alg, missing
 * kid, key-fetch failure, bad signature, stale token, body-hash mismatch)
 * results in a fail-closed 401.
 *
 * @see https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export const verifyPlaidSignature: RequestHandler = async (
  req: WebhookRequest,
  res: Response,
  next: NextFunction
) => {
  // FAIL CLOSED: never accept a Plaid webhook when the Plaid client has no
  // credentials configured — verification key fetches would fail anyway.
  if (!plaidClient.isConfigured()) {
    console.error('[webhookAuth] Plaid client not configured - rejecting webhook')
    return webhookUnauthorized(res, 'Plaid webhook verification not configured')
  }

  const signedJwt = req.headers['plaid-verification'] as string

  if (!signedJwt) {
    console.error('[webhookAuth] Missing Plaid-Verification header')
    return webhookUnauthorized(res, 'Missing Plaid verification')
  }

  // Require the RAW body so the body-hash check is meaningful (re-serialized
  // JSON is not byte-identical to what Plaid hashed). Fail closed otherwise.
  if (!req.rawBody) {
    console.error('[webhookAuth] Plaid raw body unavailable - cannot verify webhook')
    return webhookUnauthorized(res, 'Plaid raw body unavailable for verification')
  }
  const rawBody = req.rawBody.toString('utf8')

  try {
    // Decode (do NOT trust) the protected header to learn the key id and
    // algorithm. The signature is verified below with the resolved JWK.
    let header: { alg?: string; kid?: string }
    try {
      header = decodeProtectedHeader(signedJwt) as { alg?: string; kid?: string }
    } catch (decodeError) {
      console.error('[webhookAuth] Plaid JWT header decode failed:', decodeError)
      return webhookUnauthorized(res, 'Invalid Plaid verification token')
    }

    // Pin the algorithm to ES256 — Plaid signs webhooks with ES256. Reject any
    // other algorithm (including "none") to avoid alg-confusion attacks.
    if (header.alg !== 'ES256') {
      console.error(`[webhookAuth] Plaid JWT unexpected alg "${header.alg}" (expected ES256)`)
      return webhookUnauthorized(res, 'Invalid Plaid signature algorithm')
    }

    if (!header.kid) {
      console.error('[webhookAuth] Plaid JWT missing kid')
      return webhookUnauthorized(res, 'Missing Plaid verification key id')
    }

    // Resolve the public verification key for this kid (cached by kid). A fetch
    // failure throws and is caught below as a fail-closed 401.
    let jwk: PlaidJWK
    try {
      jwk = await getPlaidVerificationKey(header.kid)
    } catch (keyError) {
      console.error('[webhookAuth] Plaid verification key fetch failed:', keyError)
      return webhookUnauthorized(res, 'Plaid verification key unavailable')
    }

    // Import the JWK and verify the compact JWT signature, pinned to ES256.
    let payload: { iat?: number; request_body_sha256?: string }
    try {
      const publicKey = await importJWK(jwk, 'ES256')
      const result = await jwtVerify(signedJwt, publicKey, { algorithms: ['ES256'] })
      payload = result.payload as { iat?: number; request_body_sha256?: string }
    } catch (verifyError) {
      console.error('[webhookAuth] Plaid JWT signature verification failed:', verifyError)
      return webhookUnauthorized(res, 'Invalid Plaid signature')
    }

    // Verify the claims
    const now = Math.floor(Date.now() / 1000)

    // Check freshness (5 minutes tolerance on issued-at)
    if (payload.iat && now - payload.iat > 300) {
      console.error('[webhookAuth] Plaid webhook JWT expired')
      return webhookUnauthorized(res, 'Plaid webhook JWT expired')
    }

    // Verify the request body hash matches the signed claim.
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex')

    if (
      !payload.request_body_sha256 ||
      !timingSafeEqual(payload.request_body_sha256, bodyHash)
    ) {
      console.error('[webhookAuth] Plaid webhook body hash mismatch')
      return webhookUnauthorized(res, 'Plaid webhook body hash mismatch')
    }

    // Attach the verified flag to the request for use in handlers
    ;(req as WebhookRequest & { plaidVerified: boolean }).plaidVerified = true

    next()
  } catch (error) {
    console.error('[webhookAuth] Plaid signature verification error:', error)
    return webhookUnauthorized(res, 'Plaid signature verification failed')
  }
}

/**
 * Raw Body Parser Middleware
 *
 * Captures the raw request body before JSON parsing for signature verification.
 * Must be applied before the JSON body parser.
 */
export const captureRawBody: RequestHandler = (
  req: WebhookRequest,
  res: Response,
  next: NextFunction
) => {
  const chunks: Buffer[] = []

  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (chunks.length > 0) {
      req.rawBody = Buffer.concat(chunks)
    }
  })

  next()
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 *
 * crypto.timingSafeEqual throws on unequal-length buffers, so we cannot call it
 * directly on differently sized inputs. We also avoid the previous buggy
 * "compare a buffer to itself" pattern (which leaked length and always burned
 * the same time regardless of input). Instead, on a length mismatch we return
 * false immediately — the lengths of HMAC/HMAC-style digests are public, so
 * revealing a length mismatch does not leak secret content.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    return false
  }
  try {
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    // Defensive: timingSafeEqual can throw if buffer construction differed;
    // never treat a thrown comparison as a match.
    return false
  }
}

/**
 * Combined webhook authentication factory
 *
 * Returns the appropriate verification middleware based on the provider.
 */
export function createWebhookAuthMiddleware(
  provider: 'twilio' | 'sendgrid' | 'plaid'
): RequestHandler {
  switch (provider) {
    case 'twilio':
      return verifyTwilioSignature
    case 'sendgrid':
      return verifySendGridSignature
    case 'plaid':
      return verifyPlaidSignature
    default:
      throw new Error(`Unknown webhook provider: ${provider}`)
  }
}
