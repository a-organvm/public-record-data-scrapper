/**
 * Checkout success page — shown after a completed Stripe checkout.
 *
 * Retrieves the session details from the backend to display confirmation
 * with the customer's email and selected tier. Falls back gracefully if
 * the session ID is missing or the API is unavailable.
 */

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@public-records/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from '@public-records/ui/card'
import { CheckCircle, ArrowRight, Spinner } from '@phosphor-icons/react'

interface SessionDetails {
  id: string
  status: string
  paymentStatus: string
  customerEmail: string | null
  tier: string | null
  subscription: {
    id: string
    status: string | null
  } | null
}

interface CheckoutSuccessProps {
  onNavigateHome: () => void
}

const TIER_LABELS: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional'
}

export function CheckoutSuccess({ onNavigateHome }: CheckoutSuccessProps) {
  const sessionId = useMemo(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return params.get('session_id')
  }, [])

  const [session, setSession] = useState<SessionDetails | null>(null)
  const [loading, setLoading] = useState(!!sessionId)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!sessionId) return

    fetch(`/api/billing/session/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Session fetch failed')
        return res.json()
      })
      .then(setSession)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [sessionId])

  return (
    <main className="container mx-auto px-3 sm:px-4 md:px-6 py-12 sm:py-16 md:py-24 max-w-2xl">
      <Card className="border-green-500/30 bg-green-500/5">
        <CardHeader className="text-center pb-2">
          {loading ? (
            <div className="flex justify-center mb-4">
              <Spinner size={48} className="text-white/50 animate-spin" />
            </div>
          ) : (
            <div className="flex justify-center mb-4">
              <div className="p-3 rounded-full bg-green-500/20">
                <CheckCircle size={48} weight="fill" className="text-green-400" />
              </div>
            </div>
          )}

          <CardTitle className="text-2xl sm:text-3xl text-white">
            {loading ? 'Processing...' : 'Welcome Aboard'}
          </CardTitle>
          <CardDescription className="text-white/60 text-base mt-2">
            {loading
              ? 'Confirming your subscription...'
              : error
                ? 'Your payment was received. You can start using the platform immediately.'
                : 'Your subscription is active. You now have full access to UCC-MCA intelligence.'}
          </CardDescription>
        </CardHeader>

        {session && !loading && (
          <>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg bg-white/5 border border-white/10 p-4 space-y-2">
                {session.customerEmail && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Email</span>
                    <span className="text-white font-medium">{session.customerEmail}</span>
                  </div>
                )}
                {session.tier && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Plan</span>
                    <span className="text-white font-medium">
                      {TIER_LABELS[session.tier] ?? session.tier}
                    </span>
                  </div>
                )}
                {session.subscription?.status && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Status</span>
                    <span className="text-green-400 font-medium capitalize">
                      {session.subscription.status}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </>
        )}

        <CardFooter className="pt-4 flex flex-col gap-3">
          <Button variant="default" size="lg" className="w-full" onClick={onNavigateHome}>
            Go to Dashboard
            <ArrowRight size={16} weight="bold" className="ml-1" />
          </Button>
          <p className="text-xs text-white/40 text-center">
            A confirmation email has been sent to your inbox. You can manage your subscription at
            any time from the billing settings.
          </p>
        </CardFooter>
      </Card>
    </main>
  )
}

export default CheckoutSuccess
