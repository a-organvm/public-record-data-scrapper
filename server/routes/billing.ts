/**
 * Billing routes — Stripe checkout, session retrieval, and webhook handling.
 *
 * POST /api/billing/checkout          — create a checkout session for a given tier
 * POST /api/billing/webhook           — handle Stripe webhook events
 * GET  /api/billing/status            — check if billing is configured + which tiers are active
 * GET  /api/billing/session/:sessionId — retrieve checkout session details (post-purchase)
 */

import { Router, Request, Response } from 'express'
import {
  createCheckoutSession,
  constructWebhookEvent,
  isStripeConfigured,
  resolvePriceId,
  retrieveCheckoutSession,
  getConfiguredTiers,
  type PricingTier
} from '../integrations/stripe'

const router = Router()

const VALID_TIERS: PricingTier[] = ['starter', 'professional']

router.get('/status', (_req: Request, res: Response) => {
  const configured = isStripeConfigured()
  res.json({
    configured,
    provider: 'stripe',
    tiers: configured ? getConfiguredTiers() : {}
  })
})

router.post('/checkout', async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Billing not configured' })
      return
    }

    const { tier, email } = req.body as { tier?: string; email?: string }

    if (!tier || !VALID_TIERS.includes(tier as PricingTier)) {
      res.status(400).json({
        error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`
      })
      return
    }

    let priceId: string
    try {
      priceId = resolvePriceId(tier as PricingTier)
    } catch {
      res.status(503).json({
        error: `Tier "${tier}" is not yet configured in Stripe. Contact support.`
      })
      return
    }

    const origin = req.headers.origin || 'http://localhost:5173'

    const session = await createCheckoutSession({
      priceId,
      customerEmail: email,
      successUrl: `${origin}/#/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/#/billing/cancel`,
      metadata: {
        source: 'public-record-data-scrapper',
        tier
      }
    })

    res.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    console.error('[billing] Checkout error:', error)
    res.status(500).json({
      error: 'Failed to create checkout session'
    })
  }
})

router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Billing not configured' })
      return
    }

    const sessionId = req.params.sessionId as string
    if (!sessionId || !sessionId.startsWith('cs_')) {
      res.status(400).json({ error: 'Invalid session ID' })
      return
    }

    const session = await retrieveCheckoutSession(sessionId)
    res.json(session)
  } catch (error) {
    console.error('[billing] Session retrieval error:', error)
    res.status(500).json({ error: 'Failed to retrieve session' })
  }
})

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature']
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' })
      return
    }

    // Use the raw body stored by the raw body middleware
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody || req.body
    const event = await constructWebhookEvent(rawBody, signature)

    const obj = event.data

    switch (event.type) {
      case 'checkout.session.completed': {
        const details = obj.customer_details as Record<string, unknown> | undefined
        const metadata = obj.metadata as Record<string, string> | undefined
        console.log('[billing] Checkout completed:', {
          email: (details?.email as string) ?? obj.customer_email,
          tier: metadata?.tier
        })
        break
      }
      case 'customer.subscription.created':
        console.log('[billing] Subscription created:', {
          subscriptionId: obj.id,
          status: obj.status
        })
        break
      case 'customer.subscription.updated':
        console.log('[billing] Subscription updated:', {
          subscriptionId: obj.id,
          status: obj.status,
          cancelAtPeriodEnd: obj.cancel_at_period_end
        })
        break
      case 'customer.subscription.deleted':
        console.log('[billing] Subscription cancelled:', {
          subscriptionId: obj.id
        })
        break
      case 'invoice.payment_succeeded':
        console.log('[billing] Payment succeeded:', {
          invoiceId: obj.id,
          email: obj.customer_email,
          amountPaid: obj.amount_paid
        })
        break
      case 'invoice.payment_failed':
        console.error('[billing] Payment failed:', {
          invoiceId: obj.id,
          email: obj.customer_email,
          attemptCount: obj.attempt_count
        })
        break
      default:
        console.log(`[billing] Unhandled event: ${event.type}`)
    }

    res.json({ received: true })
  } catch (error) {
    console.error('[billing] Webhook error:', error)
    res.status(400).json({
      error: 'Webhook processing failed'
    })
  }
})

export default router
