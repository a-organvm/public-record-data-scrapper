/**
 * Pricing page — displays MCA/UCC public record intelligence subscription tiers.
 *
 * Three tiers targeted at the MCA industry:
 *   - Starter ($49/mo): Individual loan officers and brokers
 *   - Professional ($149/mo): Agencies and ISO teams
 *   - Enterprise (custom): Large operations, ISOs, and institutional buyers
 *
 * Checks /api/billing/status to determine which tiers have active Stripe price IDs.
 * If Stripe is not configured, shows a "coming soon" state on checkout buttons.
 */

import { useState, useEffect } from 'react'
import { Button } from '@public-records/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Separator } from '@public-records/ui/separator'
import { Check, ArrowLeft, Lightning, Buildings, Crown } from '@phosphor-icons/react'

interface BillingStatus {
  configured: boolean
  provider: string
  tiers: Record<string, boolean>
}

interface PricingPageProps {
  onNavigateBack: () => void
}

const TIERS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: '$49',
    period: '/mo',
    icon: Lightning,
    badge: null,
    description:
      'For individual loan officers and brokers tracking UCC filings in their territory.',
    features: [
      '1,000 UCC filing lookups per month',
      '5 state jurisdictions',
      'Basic debtor & secured party data',
      'MCA likelihood scoring',
      'CSV & JSON export',
      'Email support'
    ],
    cta: 'Start with Starter',
    highlighted: false
  },
  {
    id: 'professional' as const,
    name: 'Professional',
    price: '$149',
    period: '/mo',
    icon: Buildings,
    badge: 'Most Popular',
    description: 'For agencies and ISO teams running multi-state lead generation campaigns.',
    features: [
      '15,000 UCC filing lookups per month',
      'All 50 state jurisdictions',
      'Full debtor, secured party & amendment history',
      'Advanced MCA scoring with confidence bands',
      'Batch processing & API access',
      'Growth signal detection (hiring, contracts, revenue)',
      'Competitive intelligence dashboard',
      'Priority support with 4-hour SLA'
    ],
    cta: 'Go Professional',
    highlighted: true
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    icon: Crown,
    badge: null,
    description:
      'For ISOs, large operations, and institutional buyers who need dedicated infrastructure.',
    features: [
      'Unlimited UCC filing lookups',
      'Dedicated scraping infrastructure',
      'Custom data enrichment pipelines',
      'White-label API with your branding',
      'Agentic AI system with autonomous workflows',
      'SSO & team management',
      'Custom integrations (CRM, dialer, LOS)',
      'SLA guarantee with 99.9% uptime',
      'Dedicated account manager'
    ],
    cta: 'Contact Sales',
    highlighted: false
  }
] as const

export function PricingPage({ onNavigateBack }: PricingPageProps) {
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then(setBillingStatus)
      .catch(() => setBillingStatus({ configured: false, provider: 'none', tiers: {} }))
  }, [])

  async function handleCheckout(tier: string) {
    if (tier === 'enterprise') {
      window.location.href =
        'mailto:sales@ucc-intelligence.com?subject=Enterprise%20Inquiry&body=I%27m%20interested%20in%20the%20Enterprise%20plan%20for%20UCC-MCA%20Intelligence.'
      return
    }

    setLoadingTier(tier)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier })
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('[pricing] No checkout URL returned:', data)
      }
    } catch (error) {
      console.error('[pricing] Checkout failed:', error)
    } finally {
      setLoadingTier(null)
    }
  }

  function isTierAvailable(tierId: string): boolean {
    if (tierId === 'enterprise') return true
    return !!billingStatus?.configured && !!billingStatus.tiers[tierId]
  }

  return (
    <main className="container mx-auto px-3 sm:px-4 md:px-6 py-8 sm:py-12 md:py-16 max-w-6xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNavigateBack}
          className="text-white/70 hover:text-white"
        >
          <ArrowLeft size={16} weight="bold" className="mr-1" />
          Back to Dashboard
        </Button>
      </div>

      <div className="text-center mb-10 sm:mb-14">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-3">
          Public Record Intelligence Pricing
        </h1>
        <p className="text-base sm:text-lg text-white/70 max-w-2xl mx-auto">
          Turn UCC filings and MCA data into qualified leads. Real-time scraping, scoring, and
          enrichment across all 50 states.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mb-12">
        {TIERS.map((tier) => {
          const Icon = tier.icon
          const available = isTierAvailable(tier.id)
          const isLoading = loadingTier === tier.id

          return (
            <Card
              key={tier.id}
              className={`relative flex flex-col ${
                tier.highlighted
                  ? 'border-primary/60 bg-primary/5 shadow-2xl shadow-primary/20 scale-[1.02]'
                  : 'border-white/10 bg-card/50'
              }`}
            >
              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge variant="default" className="text-xs px-3 py-1">
                    {tier.badge}
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`p-2 rounded-lg ${tier.highlighted ? 'bg-primary/20' : 'bg-white/10'}`}
                  >
                    <Icon
                      size={20}
                      weight="fill"
                      className={tier.highlighted ? 'text-primary' : 'text-white/80'}
                    />
                  </div>
                  <CardTitle className="text-xl text-white">{tier.name}</CardTitle>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold text-white">{tier.price}</span>
                  {tier.period && <span className="text-base text-white/50">{tier.period}</span>}
                </div>
                <CardDescription className="text-white/60 text-sm leading-relaxed">
                  {tier.description}
                </CardDescription>
              </CardHeader>

              <Separator className="bg-white/10" />

              <CardContent className="flex-1 pt-4">
                <ul className="space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-white/80">
                      <Check
                        size={16}
                        weight="bold"
                        className={`mt-0.5 shrink-0 ${tier.highlighted ? 'text-primary' : 'text-green-400'}`}
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="pt-4">
                <Button
                  variant={tier.highlighted ? 'default' : 'outline'}
                  size="lg"
                  className="w-full"
                  onClick={() => handleCheckout(tier.id)}
                  disabled={(!available && tier.id !== 'enterprise') || isLoading}
                >
                  {isLoading ? 'Redirecting to Stripe...' : available ? tier.cta : 'Coming Soon'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <div className="text-center space-y-4">
        <p className="text-white/50 text-sm">
          All plans include a 14-day free trial. No credit card required to start. Cancel anytime.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-white/40">
          <span>SOC 2 Compliant</span>
          <span className="hidden sm:inline">|</span>
          <span>256-bit SSL Encryption</span>
          <span className="hidden sm:inline">|</span>
          <span>TCPA & FCRA Aware</span>
          <span className="hidden sm:inline">|</span>
          <span>99.9% Uptime SLA (Enterprise)</span>
        </div>
      </div>
    </main>
  )
}

export default PricingPage
