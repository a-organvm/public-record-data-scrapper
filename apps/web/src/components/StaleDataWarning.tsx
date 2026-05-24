import { Alert, AlertDescription } from '@public-records/ui/alert'
import { Button } from '@public-records/ui/button'
import { ClockCounterClockwise, ArrowClockwise } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

interface StaleDataWarningProps {
  lastUpdated: string
  onRefresh: () => void
}

export function StaleDataWarning({ lastUpdated, onRefresh }: StaleDataWarningProps) {
  // Refresh `now` periodically so the "N days old" age doesn't freeze at mount
  // time. Lazy initializer keeps the render itself pure.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const daysSinceUpdate = Math.floor(
    (now - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysSinceUpdate < 7) return null

  const severity = daysSinceUpdate >= 30 ? 'destructive' : 'default'

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Alert variant={severity} className="mb-4 sm:mb-6 glass-effect border-white/30">
        <ClockCounterClockwise size={18} weight="fill" className="sm:w-5 sm:h-5" />
        <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-sm sm:text-base">
            <span className="font-semibold">Data is {daysSinceUpdate} days old.</span>
            <span className="block sm:inline">
              {' '}
              {daysSinceUpdate >= 30
                ? 'Critical: Health scores may be inaccurate.'
                : 'Consider refreshing for latest signals.'}
            </span>
          </span>
          <Button
            variant={severity === 'destructive' ? 'destructive' : 'outline'}
            size="sm"
            onClick={onRefresh}
            className="glass-effect border-white/30 w-full sm:w-auto"
          >
            <ArrowClockwise size={14} weight="bold" className="mr-2 sm:w-4 sm:h-4" />
            Refresh Now
          </Button>
        </AlertDescription>
      </Alert>
    </motion.div>
  )
}
