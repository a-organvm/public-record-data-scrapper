/**
 * Pricing page — captures work-email intent and routes users into the correct plan path.
 *
 * Public plan model:
 *   - Free ($0): preview / light usage
 *   - Starter ($49): individual operators
 *   - Pro ($149): agencies and ISO teams
 *
 * Paid plans continue into Stripe when configured; otherwise the backend records
 * the request as a waitlist lead so pricing intent is still captured.
 */

import { useEffect, useState } from 'react'
import { Button } from '@public-records/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Separator } from '@public-records/ui/separator'
import { Input } from '@public-records/ui/input'
import { navigateToExternal } from './navigation'
import { ArrowLeft, Buildings, Check, EnvelopeSimple, Lightning } from '@phosphor-icons/react'

interface BillingStatus {
  configured: boolean
  provider: string
  tiers: Record<string, boolean>
}

interface SignupFeedback {
  tone: 'success' | 'warning' | 'error'
  title: string
  message: string
}

interface PricingPageProps {
  onNavigateBack: () => void
}

type PricingPlanId = 'free' | 'starter' | 'pro'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TIERS = [
  {
    id: 'free' as PricingPlanId,
    name: 'Free',
    price: '$0',
    period: '/mo',
    icon: EnvelopeSimple,
    badge: 'Fastest Start',
    description: 'For solo operators validating fit before they spend money or team time.',
    features: [
      '100 UCC filing lookups per month',
      '1 state jurisdiction',
      'Basic debtor and secured party visibility',
      'Email delivery of exported results',
      'Priority upgrade path into paid plans'
    ],
    cta: 'Start Free',
    highlighted: false
  },
  {
    id: 'starter' as PricingPlanId,
    name: 'Starter',
    price: '$49',
    period: '/mo',
    icon: Lightning,
    badge: null,
    description:
      'For individual loan officers and brokers who need consistent deal flow in-market.',
    features: [
      '1,000 UCC filing lookups per month',
      '5 state jurisdictions',
      'Basic debtor and secured party data',
      'MCA likelihood scoring',
      'CSV and JSON export',
      'Email support'
    ],
    cta: 'Start Starter',
    highlighted: false
  },
  {
    id: 'pro' as PricingPlanId,
    name: 'Pro',
    price: '$149',
    period: '/mo',
    icon: Buildings,
    badge: 'Most Popular',
    description: 'For agencies and ISO teams running repeatable multi-state lead generation.',
    features: [
      '15,000 UCC filing lookups per month',
      'All 50 state jurisdictions',
      'Full debtor, secured party, and amendment history',
      'Advanced MCA scoring with confidence bands',
      'Batch processing and API access',
      'Growth signal detection and competitive dashboards',
      'Priority support with 4-hour SLA'
    ],
    cta: 'Go Pro',
    highlighted: true
  }
] as const

export function PricingPage({ onNavigateBack }: PricingPageProps) {
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [email, setEmail] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [loadingPlan, setLoadingPlan] = useState<PricingPlanId | null>(null)
  const [feedback, setFeedback] = useState<SignupFeedback | null>(null)

  useEffect(() => {
    fetch('/api/billing/status')
      .then((response) => response.json())
      .then(setBillingStatus)
      .catch(() => setBillingStatus({ configured: false, provider: 'none', tiers: {} }))
  }, [])

  const normalizedEmail = email.trim().toLowerCase()
  const isEmailValid = EMAIL_PATTERN.test(normalizedEmail)

  async function handleSignup(plan: PricingPlanId) {
    if (!isEmailValid) {
      setFeedback({
        tone: 'error',
        title: 'Work Email Required',
        message: 'Enter a valid work email to start free access or continue into checkout.'
      })
      return
    }

    setLoadingPlan(plan)
    setFeedback(null)

    try {
      const response = await fetch('/api/billing/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          email: normalizedEmail,
          companyName: companyName.trim() || undefined
        })
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed')
      }

      if (data.mode === 'checkout' && data.url) {
        navigateToExternal(data.url)
        return
      }

      if (data.mode === 'free') {
        setFeedback({
          tone: 'success',
          title: 'Free Access Captured',
          message:
            'Your free plan request is in. We will use this email to deliver onboarding and your first dataset.'
        })
        return
      }

      if (data.mode === 'waitlist') {
        setFeedback({
          tone: 'warning',
          title: 'Waitlist Confirmed',
          message:
            'We captured your interest. Stripe is not fully configured for this paid tier yet, so we will follow up directly.'
        })
        return
      }

      setFeedback({
        tone: 'success',
        title: 'Signup Captured',
        message: 'Your request has been recorded and the team will follow up from this email.'
      })
    } catch (error) {
      console.error('[pricing] Signup failed:', error)
      setFeedback({
        tone: 'error',
        title: 'Signup Failed',
        message:
          error instanceof Error
            ? error.message
            : 'We could not process your signup right now. Try again in a moment.'
      })
    } finally {
      setLoadingPlan(null)
    }
  }

  function getPlanAvailability(plan: PricingPlanId) {
    if (plan === 'free') {
      return {
        available: true,
        buttonLabel: 'Start Free'
      }
    }

    const available = !!billingStatus?.configured && !!billingStatus.tiers[plan]
    const defaultCta = TIERS.find((tier) => tier.id === plan)?.cta || 'Continue'

    return {
      available,
      buttonLabel: available ? defaultCta : 'Join Waitlist'
    }
  }

  return (
    <main className="container mx-auto max-w-6xl px-3 py-8 sm:px-4 sm:py-12 md:px-6 md:py-16">
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

      <div className="mb-10 text-center sm:mb-14">
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
          Public Record Intelligence Pricing
        </h1>
        <p className="mx-auto max-w-2xl text-base text-white/70 sm:text-lg">
          Turn UCC filings into qualified MCA leads. Start with one work email, then move into the
          plan that matches your deal volume.
        </p>
      </div>

      <Card className="mb-8 border-white/10 bg-card/60 shadow-2xl shadow-primary/10">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl text-white">Start With One Work Email</CardTitle>
              <CardDescription className="mt-2 max-w-2xl text-white/60">
                Free signups are captured immediately. Paid plans use the same email to prefill
                Stripe checkout or, if billing is not live yet, to place you on the waitlist.
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-white/20 text-white/70">
              {billingStatus?.configured ? 'Stripe Live' : 'Waitlist Mode'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <label htmlFor="pricing-email" className="text-sm font-medium text-white">
              Work Email
            </label>
            <Input
              id="pricing-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@fundingteam.com"
              className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
            />
            {!isEmailValid && email.length > 0 && (
              <p className="text-sm text-amber-300">
                Enter a valid email so we can attach onboarding or checkout to a real inbox.
              </p>
            )}
          </div>
          <div className="space-y-3">
            <label htmlFor="pricing-company" className="text-sm font-medium text-white">
              Company Name
              <span className="ml-2 text-white/40">(Optional)</span>
            </label>
            <Input
              id="pricing-company"
              type="text"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Acme Capital"
              className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
            />
          </div>
        </CardContent>
      </Card>

      {feedback && (
        <div
          className={`mb-8 rounded-2xl border px-4 py-4 sm:px-5 ${
            feedback.tone === 'success'
              ? 'border-emerald-400/30 bg-emerald-500/10'
              : feedback.tone === 'warning'
                ? 'border-amber-400/30 bg-amber-500/10'
                : 'border-rose-400/30 bg-rose-500/10'
          }`}
        >
          <p className="text-sm font-semibold text-white">{feedback.title}</p>
          <p className="mt-1 text-sm text-white/75">{feedback.message}</p>
        </div>
      )}

      <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8">
        {TIERS.map((plan) => {
          const Icon = plan.icon
          const { available, buttonLabel } = getPlanAvailability(plan.id)
          const isLoading = loadingPlan === plan.id

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${
                plan.highlighted
                  ? 'scale-[1.02] border-primary/60 bg-primary/5 shadow-2xl shadow-primary/20'
                  : 'border-white/10 bg-card/50'
              }`}
            >
              {plan.badge && (
                <div className="absolute left-1/2 top-[-0.75rem] -translate-x-1/2">
                  <Badge variant="default" className="px-3 py-1 text-xs">
                    {plan.badge}
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-2">
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className={`rounded-lg p-2 ${plan.highlighted ? 'bg-primary/20' : 'bg-white/10'}`}
                  >
                    <Icon
                      size={20}
                      weight="fill"
                      className={plan.highlighted ? 'text-primary' : 'text-white/80'}
                    />
                  </div>
                  <CardTitle className="text-xl text-white">{plan.name}</CardTitle>
                </div>
                <div className="mb-2 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  {plan.period && <span className="text-base text-white/50">{plan.period}</span>}
                </div>
                <CardDescription className="text-sm leading-relaxed text-white/60">
                  {plan.description}
                </CardDescription>
              </CardHeader>

              <Separator className="bg-white/10" />

              <CardContent className="flex-1 pt-4">
                <ul className="space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-white/80">
                      <Check
                        size={16}
                        weight="bold"
                        className={`mt-0.5 shrink-0 ${plan.highlighted ? 'text-primary' : 'text-green-400'}`}
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="pt-4">
                <Button
                  variant={plan.highlighted ? 'default' : 'outline'}
                  size="lg"
                  className="w-full"
                  onClick={() => void handleSignup(plan.id)}
                  disabled={isLoading}
                >
                  {isLoading
                    ? plan.id === 'free'
                      ? 'Capturing Signup...'
                      : available
                        ? 'Redirecting to Stripe...'
                        : 'Joining Waitlist...'
                    : buttonLabel}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <Card className="mb-10 border-white/10 bg-card/50">
        <CardContent className="py-6 text-center">
          <p className="text-base font-medium text-white">
            Need higher-volume, white-label, or dedicated infrastructure?
          </p>
          <p className="mt-2 text-sm text-white/65">
            Reply from the signup email and ask for enterprise infrastructure, custom data
            enrichment, or dedicated scraping capacity.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4 text-center">
        <p className="text-sm text-white/50">
          Free starts with email only. Paid plans continue into Stripe when configured. You can
          still express intent even if a tier is waitlisted.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-white/40">
          <span>SOC 2 Compliant</span>
          <span className="hidden sm:inline">|</span>
          <span>256-bit SSL Encryption</span>
          <span className="hidden sm:inline">|</span>
          <span>TCPA & FCRA Aware</span>
          <span className="hidden sm:inline">|</span>
          <span>50-State Coverage</span>
        </div>
      </div>
    </main>
  )
}

export default PricingPage
