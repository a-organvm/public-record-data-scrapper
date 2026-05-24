/**
 * Billing routes — Stripe checkout and webhook handling.
 *
 * POST /api/billing/checkout — create a checkout session
 * POST /api/billing/webhook  — handle Stripe webhook events
 * GET  /api/billing/status   — check if billing is configured
 *
 * NOTE: This router is mounted with `express.raw` so the webhook handler
 * receives the raw request body as a Buffer (required for Stripe signature
 * verification). Do not assume `req.body` is parsed JSON here.
 */

import { Router, Request, Response } from 'express'
import { asyncHandler } from '../middleware/errorHandler'
import { config } from '../config'
import {
  createCheckoutSession,
  constructWebhookEvent,
  isStripeConfigured
} from '../integrations/stripe'

const router = Router()

/**
 * Validates a request Origin against the configured CORS allowlist and returns
 * a safe base URL for building checkout redirect URLs. Falls back to the first
 * configured origin (or BILLING_BASE_URL) when the Origin is missing or not
 * allowlisted, preventing open-redirect / host-injection via the Origin header.
 */
function resolveCheckoutBaseUrl(req: Request): string | null {
  const allowedOrigins = config.cors.origin
  const origin = req.headers.origin

  if (origin && allowedOrigins.includes(origin)) {
    return origin
  }

  // Prefer an explicitly configured base URL, else the first allowlisted origin.
  const configuredBase =
    process.env.BILLING_BASE_URL ||
    (allowedOrigins.length > 0 ? allowedOrigins[0] : undefined)

  return configuredBase ?? null
}

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: isStripeConfigured(),
    provider: 'stripe'
  })
})

router.post(
  '/checkout',
  asyncHandler(async (req: Request, res: Response) => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Billing not configured' })
      return
    }

    const priceId = process.env.STRIPE_PRICE_ID
    if (!priceId) {
      res.status(503).json({ error: 'No price configured' })
      return
    }

    // Build redirect URLs from a validated base — never trust the raw Origin
    // header, which a caller can spoof to redirect users to an attacker host.
    const baseUrl = resolveCheckoutBaseUrl(req)
    if (!baseUrl) {
      res.status(500).json({ error: 'No allowed origin configured for checkout' })
      return
    }

    const session = await createCheckoutSession({
      priceId,
      successUrl: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/billing/cancel`,
      metadata: {
        source: 'public-record-data-scrapper'
      }
    })

    res.json({ url: session.url })
  })
)

router.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe.webhookSecret) {
      // Fail closed: without a configured signing secret we cannot trust any
      // payload, so reject rather than process unverified events.
      console.error('[billing] STRIPE_WEBHOOK_SECRET is not configured; rejecting webhook')
      res.status(503).json({ error: 'Webhook signing secret not configured' })
      return
    }

    const signature = req.headers['stripe-signature']
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' })
      return
    }

    // req.body is the raw Buffer (router mounted with express.raw). Verify the
    // signature before doing anything with the payload.
    let event
    try {
      event = await constructWebhookEvent(req.body as Buffer, signature)
    } catch (err) {
      console.error(
        '[billing] Webhook signature verification failed:',
        err instanceof Error ? err.message : err
      )
      res.status(400).json({ error: 'Invalid signature' })
      return
    }

    switch (event.type) {
      case 'checkout.session.completed':
        console.log('[billing] Checkout completed:', event.id)
        break
      case 'customer.subscription.created':
        console.log('[billing] Subscription created:', event.id)
        break
      case 'customer.subscription.deleted':
        console.log('[billing] Subscription cancelled:', event.id)
        break
      case 'invoice.payment_succeeded':
        console.log('[billing] Payment succeeded:', event.id)
        break
      case 'invoice.payment_failed':
        console.log('[billing] Payment failed:', event.id)
        break
      default:
        console.log(`[billing] Unhandled event: ${event.type}`)
    }

    res.json({ received: true })
  })
)

export default router
