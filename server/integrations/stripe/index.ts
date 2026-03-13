/**
 * Stripe integration — handles checkout sessions and webhook events.
 *
 * Activation steps:
 * 1. npm install stripe
 * 2. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env
 * 3. Create a product + price in Stripe Dashboard
 * 4. Set STRIPE_PRICE_ID to the price ID
 */

import Stripe from 'stripe'
import { config } from '../../config'

let stripeClient: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = config.stripe?.secretKey || process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    stripeClient = new Stripe(key, { apiVersion: '2025-04-30.basil' })
  }
  return stripeClient
}

export function isStripeConfigured(): boolean {
  return !!(config.stripe?.secretKey || process.env.STRIPE_SECRET_KEY)
}

export interface CheckoutOptions {
  priceId: string
  customerId?: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}

export async function createCheckoutSession(
  options: CheckoutOptions
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: options.priceId, quantity: 1 }],
    customer: options.customerId,
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata: options.metadata
  })
}

export async function constructWebhookEvent(
  payload: Buffer,
  signature: string
): Promise<Stripe.Event> {
  const stripe = getStripe()
  const secret = config.stripe?.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  }
  return stripe.webhooks.constructEvent(payload, signature, secret)
}
