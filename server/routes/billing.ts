/**
 * Billing routes — Stripe checkout and webhook handling.
 *
 * POST /api/billing/checkout — create a checkout session
 * POST /api/billing/webhook  — handle Stripe webhook events
 * GET  /api/billing/status   — check if billing is configured
 */

import { Router, Request, Response } from 'express'
import {
  createCheckoutSession,
  constructWebhookEvent,
  isStripeConfigured
} from '../integrations/stripe'

const router = Router()

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: isStripeConfigured(),
    provider: 'stripe'
  })
})

router.post('/checkout', async (req: Request, res: Response) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: 'Billing not configured' })
    return
  }

  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    res.status(503).json({ error: 'No price configured' })
    return
  }

  const origin = req.headers.origin || 'http://localhost:5173'

  const session = await createCheckoutSession({
    priceId,
    successUrl: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/billing/cancel`,
    metadata: {
      source: 'public-record-data-scrapper'
    }
  })

  res.json({ url: session.url })
})

router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string
  if (!signature) {
    res.status(400).json({ error: 'Missing stripe-signature header' })
    return
  }

  const event = await constructWebhookEvent(req.body, signature)

  switch (event.type) {
    case 'checkout.session.completed':
      console.log('[billing] Checkout completed:', event.data.object)
      break
    case 'customer.subscription.created':
      console.log('[billing] Subscription created:', event.data.object)
      break
    case 'customer.subscription.deleted':
      console.log('[billing] Subscription cancelled:', event.data.object)
      break
    case 'invoice.payment_succeeded':
      console.log('[billing] Payment succeeded:', event.data.object)
      break
    case 'invoice.payment_failed':
      console.log('[billing] Payment failed:', event.data.object)
      break
    default:
      console.log(`[billing] Unhandled event: ${event.type}`)
  }

  res.json({ received: true })
})

export default router
