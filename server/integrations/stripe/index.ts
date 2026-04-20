/**
 * Stripe integration — handles checkout sessions, webhook events, and tier-based pricing.
 *
 * Supports three tiers:
 *   - starter: Individual loan officers ($49/mo)
 *   - professional: Agencies and ISOs ($149/mo)
 *   - enterprise: Custom pricing (contact sales — no Stripe checkout)
 *
 * Activation:
 * 1. Add stripe to package.json (done)
 * 2. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in .env
 * 3. Create products + prices in Stripe Dashboard for starter and professional tiers
 * 4. Set STRIPE_PRICE_ID_STARTER and STRIPE_PRICE_ID_PROFESSIONAL in .env
 */

import Stripe from 'stripe'
import { config } from '../../config'

export type PricingTier = 'starter' | 'professional'

let stripeClient: InstanceType<typeof Stripe> | null = null

export function getStripe(): InstanceType<typeof Stripe> {
  if (!stripeClient) {
    const key = config.stripe.secretKey
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    stripeClient = new Stripe(key)
  }
  return stripeClient
}

export function isStripeConfigured(): boolean {
  return !!config.stripe.secretKey
}

/**
 * Resolves a pricing tier to its Stripe Price ID.
 * Throws if the tier's price ID is not configured.
 */
export function resolvePriceId(tier: PricingTier): string {
  const priceId = config.stripe.priceIds[tier]
  if (!priceId) {
    throw new Error(
      `Stripe price ID for tier "${tier}" is not configured. Set STRIPE_PRICE_ID_${tier.toUpperCase()} in your environment.`
    )
  }
  return priceId
}

/**
 * Returns all configured tiers with their price IDs (for the status endpoint).
 */
export function getConfiguredTiers(): Record<PricingTier, boolean> {
  return {
    starter: !!config.stripe.priceIds.starter,
    professional: !!config.stripe.priceIds.professional
  }
}

export interface CheckoutOptions {
  priceId: string
  customerId?: string
  customerEmail?: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}

export interface CheckoutSessionResult {
  url: string | null
  id: string
}

export async function createCheckoutSession(
  options: CheckoutOptions
): Promise<CheckoutSessionResult> {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: options.priceId, quantity: 1 }],
    customer: options.customerId,
    customer_email: options.customerId ? undefined : options.customerEmail,
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata: options.metadata,
    allow_promotion_codes: true,
    billing_address_collection: 'required'
  })
  return { url: session.url, id: session.id }
}

export interface SessionDetails {
  id: string
  status: string | null
  paymentStatus: string
  customerEmail: string | null
  tier: string | null
  subscription: { id: string; status: string | null } | null
}

export async function retrieveCheckoutSession(sessionId: string): Promise<SessionDetails> {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'customer']
  })

  let subInfo: { id: string; status: string | null } | null = null
  if (session.subscription) {
    if (typeof session.subscription === 'string') {
      subInfo = { id: session.subscription, status: null }
    } else {
      subInfo = { id: session.subscription.id, status: session.subscription.status }
    }
  }

  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    customerEmail: session.customer_details?.email ?? null,
    tier: session.metadata?.tier ?? null,
    subscription: subInfo
  }
}

export interface WebhookEventResult {
  type: string
  data: Record<string, unknown>
}

export async function constructWebhookEvent(
  payload: Buffer | string,
  signature: string
): Promise<WebhookEventResult> {
  const stripe = getStripe()
  const secret = config.stripe.webhookSecret
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  }
  const event = stripe.webhooks.constructEvent(payload, signature, secret)
  return {
    type: event.type,
    data: event.data.object as unknown as Record<string, unknown>
  }
}
