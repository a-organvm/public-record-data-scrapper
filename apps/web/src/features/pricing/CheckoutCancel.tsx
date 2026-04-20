/**
 * Checkout cancel page — shown when a user cancels or backs out of Stripe checkout.
 *
 * Provides a clear path back to pricing or the main dashboard.
 * No API calls needed — this is a pure navigation/messaging page.
 */

import { Button } from '@public-records/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@public-records/ui/card'
import { XCircle, ArrowLeft, House } from '@phosphor-icons/react'

interface CheckoutCancelProps {
  onNavigateBack: () => void
  onNavigateHome: () => void
}

export function CheckoutCancel({ onNavigateBack, onNavigateHome }: CheckoutCancelProps) {
  return (
    <main className="container mx-auto px-3 sm:px-4 md:px-6 py-12 sm:py-16 md:py-24 max-w-2xl">
      <Card className="border-white/10">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-white/10">
              <XCircle size={48} weight="fill" className="text-white/50" />
            </div>
          </div>

          <CardTitle className="text-2xl sm:text-3xl text-white">Checkout Cancelled</CardTitle>
          <CardDescription className="text-white/60 text-base mt-2 max-w-md mx-auto">
            No worries — no charges were made. Your free trial or current plan remains unchanged.
            You can come back any time to subscribe.
          </CardDescription>
        </CardHeader>

        <CardFooter className="pt-6 flex flex-col sm:flex-row gap-3">
          <Button
            variant="default"
            size="lg"
            className="w-full sm:w-auto flex-1"
            onClick={onNavigateBack}
          >
            <ArrowLeft size={16} weight="bold" className="mr-1" />
            Back to Pricing
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto flex-1"
            onClick={onNavigateHome}
          >
            <House size={16} weight="bold" className="mr-1" />
            Go to Dashboard
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}

export default CheckoutCancel
