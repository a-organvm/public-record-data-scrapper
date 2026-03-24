import { useState } from 'react'
import { CoverageDashboard } from '@/components/CoverageDashboard'
import { useCoverageDashboard } from '@/hooks/useCoverageDashboard'
import { Button } from '@public-records/ui/button'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useDataTier } from '@/hooks/useDataTier'

const getNow = () => Date.now()

function formatRelativeTime(date: Date, now: number): string {
  const seconds = Math.floor((now - date.getTime()) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function CoverageTab() {
  const { dataTier } = useDataTier()
  const { loading, error, lastRefreshed, refresh } = useCoverageDashboard({
    pollIntervalMs: 30000,
    fallbackToPreview: true
  })
  const [renderNow] = useState(getNow)

  const lastRefreshedLabel = lastRefreshed
    ? `Last refreshed ${formatRelativeTime(lastRefreshed, renderNow)}`
    : 'Loading...'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{lastRefreshedLabel}</span>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <ArrowsClockwise className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <CoverageDashboard dataTier={dataTier} usePreviewData={false} />
    </div>
  )
}
