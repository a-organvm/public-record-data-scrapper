/**
 * Billing routes — Stripe checkout, session retrieval, and webhook handling.
 *
 * POST /api/billing/signup            — capture a pricing signup, optionally start Stripe checkout
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
import { billingSignupService, type BillingSignupPlan } from '../services/BillingSignupService'

const router = Router()

const VALID_TIERS: PricingTier[] = ['starter', 'professional']
const VALID_SIGNUP_PLANS: BillingSignupPlan[] = ['free', 'starter', 'pro']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizePricingTier(tier?: string): PricingTier | null {
  if (tier === 'starter') return 'starter'
  if (tier === 'professional' || tier === 'pro') return 'professional'
  return null
}

function isValidEmail(email?: string): email is string {
  return !!email && EMAIL_PATTERN.test(email.trim())
}

function getPublicTierAvailability() {
  const configuredTiers = getConfiguredTiers()
  return {
    starter: configuredTiers.starter,
    pro: configuredTiers.professional
  }
}

function resolveFrontendOrigin(req: Request): string {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    return origin
  }

  const forwardedHost = req.headers['x-forwarded-host']
  const forwardedProto = req.headers['x-forwarded-proto']
  if (typeof forwardedHost === 'string' && forwardedHost.length > 0) {
    const protocol =
      typeof forwardedProto === 'string' && forwardedProto.length > 0 ? forwardedProto : 'https'
    return `${protocol}://${forwardedHost}`
  }

  return 'http://localhost:5173'
}

router.get('/status', (_req: Request, res: Response) => {
  const configured = isStripeConfigured()
  res.json({
    configured,
    provider: 'stripe',
    tiers: configured ? getPublicTierAvailability() : {}
  })
})

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { plan, email, companyName } = req.body as {
      plan?: string
      email?: string
      companyName?: string
    }

    if (!plan || !VALID_SIGNUP_PLANS.includes(plan as BillingSignupPlan)) {
      res.status(400).json({
        error: `Invalid plan. Must be one of: ${VALID_SIGNUP_PLANS.join(', ')}`
      })
      return
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'A valid email address is required' })
      return
    }

    const signup = await billingSignupService.capture({
      email: email.trim().toLowerCase(),
      plan: plan as BillingSignupPlan,
      companyName,
      source: 'pricing-page'
    })

    if (plan === 'free') {
      res.status(201).json({
        success: true,
        mode: 'free',
        signup
      })
      return
    }

    const tier = normalizePricingTier(plan)
    if (!tier) {
      res.status(400).json({ error: 'Invalid paid tier' })
      return
    }

    if (!isStripeConfigured()) {
      await billingSignupService.updateStatus(signup.id, 'waitlisted')
      res.status(202).json({
        success: true,
        mode: 'waitlist',
        signup: {
          ...signup,
          status: 'waitlisted'
        },
        message: 'Billing is not configured yet. Your interest has been captured.'
      })
      return
    }

    let priceId: string
    try {
      priceId = resolvePriceId(tier)
    } catch {
      await billingSignupService.updateStatus(signup.id, 'waitlisted')
      res.status(202).json({
        success: true,
        mode: 'waitlist',
        signup: {
          ...signup,
          status: 'waitlisted'
        },
        message: `Plan "${plan}" is not yet configured in Stripe. Your interest has been captured.`
      })
      return
    }

    const origin = resolveFrontendOrigin(req)
    const session = await createCheckoutSession({
      priceId,
      customerEmail: email.trim().toLowerCase(),
      successUrl: `${origin}/#/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/#/billing/cancel`,
      metadata: {
        source: 'public-record-data-scrapper',
        plan,
        tier
      }
    })

    await billingSignupService.markCheckoutStarted(signup.id, session.id)

    res.json({
      success: true,
      mode: 'checkout',
      signupId: signup.id,
      url: session.url,
      sessionId: session.id
    })
  } catch (error) {
    console.error('[billing] Signup error:', error)
    res.status(500).json({
      error: 'Failed to process pricing signup'
    })
  }
})

router.post('/checkout', async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Billing not configured' })
      return
    }

    const { tier, email } = req.body as { tier?: string; email?: string }
    const normalizedTier = normalizePricingTier(tier)

    if (!normalizedTier || !VALID_TIERS.includes(normalizedTier)) {
      res.status(400).json({
        error: 'Invalid tier. Must be one of: starter, professional, pro'
      })
      return
    }

    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'A valid email address is required' })
      return
    }

    let priceId: string
    try {
      priceId = resolvePriceId(normalizedTier)
    } catch {
      res.status(503).json({
        error: `Tier "${tier}" is not yet configured in Stripe. Contact support.`
      })
      return
    }

    const origin = resolveFrontendOrigin(req)

    const session = await createCheckoutSession({
      priceId,
      customerEmail: email,
      successUrl: `${origin}/#/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/#/billing/cancel`,
      metadata: {
        source: 'public-record-data-scrapper',
        tier: normalizedTier,
        plan: normalizedTier === 'professional' ? 'pro' : normalizedTier
      }
    })

    if (email) {
      const signup = await billingSignupService.capture({
        email: email.trim().toLowerCase(),
        plan: normalizedTier === 'professional' ? 'pro' : normalizedTier,
        source: 'direct-checkout'
      })
      await billingSignupService.markCheckoutStarted(signup.id, session.id)
    }

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
        const checkoutSessionId = typeof obj.id === 'string' ? obj.id : null
        const subscriptionId =
          typeof obj.subscription === 'string'
            ? obj.subscription
            : ((obj.subscription as { id?: string } | undefined)?.id ?? null)

        if (checkoutSessionId) {
          await billingSignupService.markSubscribedByCheckoutSession(
            checkoutSessionId,
            subscriptionId
          )
        }

        console.log('[billing] Checkout completed:', {
          email: (details?.email as string) ?? obj.customer_email,
          tier: metadata?.plan ?? metadata?.tier
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
