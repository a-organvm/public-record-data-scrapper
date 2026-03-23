/**
 * Data Pipeline Status Component
 *
 * Displays the status of the data ingestion and enrichment pipeline
 */

import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@public-records/ui/card'
import { Progress } from '@public-records/ui/progress'
import {
  Database,
  CheckCircle,
  XCircle,
  Clock,
  ArrowClockwise,
  Warning,
  Play,
  Pause
} from '@phosphor-icons/react'
import { featureFlags } from '@/lib/config/dataPipeline'

export interface DataPipelineStatusProps {
  loading: boolean
  error: string | null
  lastUpdate: string | null
  schedulerStatus: {
    running: boolean
    lastIngestionRun?: string
    lastEnrichmentRun?: string
    lastRefreshRun?: string
    totalProspectsProcessed: number
    totalErrors: number
  } | null
  onRefresh: () => void
  onStartScheduler?: () => void
  onStopScheduler?: () => void
  onTriggerIngestion?: () => void
}

export function DataPipelineStatus({
  loading,
  error,
  lastUpdate,
  schedulerStatus,
  onRefresh,
  onStartScheduler,
  onStopScheduler,
  onTriggerIngestion
}: DataPipelineStatusProps) {
  const formatRelativeTime = (dateString: string | undefined) => {
    if (!dateString) return 'Never'

    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const getStatusBadge = () => {
    if (loading) {
      return (
        <Badge variant="outline" className="gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Loading
        </Badge>
      )
    }

    if (error) {
      return (
        <Badge variant="destructive" className="gap-1.5">
          <XCircle className="h-3.5 w-3.5" />
          Error
        </Badge>
      )
    }

    if (featureFlags.useDemoData) {
      return (
        <Badge variant="secondary" className="gap-1.5">
          <Database className="h-3.5 w-3.5" />
          Demo Data
        </Badge>
      )
    }

    if (schedulerStatus?.running) {
      return (
        <Badge variant="default" className="gap-1.5 bg-green-600">
          <CheckCircle className="h-3.5 w-3.5" />
          Active
        </Badge>
      )
    }

    return (
      <Badge variant="outline" className="gap-1.5">
        <Pause className="h-3.5 w-3.5" />
        Paused
      </Badge>
    )
  }

  const hasErrors = schedulerStatus && schedulerStatus.totalErrors > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Data Pipeline Status
            </CardTitle>
            <CardDescription>
              {featureFlags.useDemoData
                ? 'Using preview data for development'
                : 'Real-time data ingestion and enrichment'}
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error Display */}
        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-200">
            <div className="flex items-start gap-2">
              <Warning className="h-4 w-4 mt-0.5" />
              <div>
                <div className="font-medium">Pipeline Error</div>
                <div className="mt-1 text-red-700 dark:text-red-300">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Last Update */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Last Update</span>
            <span className="font-medium">{formatRelativeTime(lastUpdate || undefined)}</span>
          </div>

          {!featureFlags.useDemoData && schedulerStatus && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Ingestion</span>
                <span className="font-medium">
                  {formatRelativeTime(schedulerStatus.lastIngestionRun)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Enrichment</span>
                <span className="font-medium">
                  {formatRelativeTime(schedulerStatus.lastEnrichmentRun)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Refresh</span>
                <span className="font-medium">
                  {formatRelativeTime(schedulerStatus.lastRefreshRun)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Statistics */}
        {!featureFlags.useDemoData && schedulerStatus && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Prospects Processed</span>
              <span className="font-medium">
                {schedulerStatus.totalProspectsProcessed.toLocaleString()}
              </span>
            </div>

            {hasErrors && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Errors</span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  {schedulerStatus.totalErrors}
                </span>
              </div>
            )}

            {hasErrors && (
              <Progress
                value={
                  (1 -
                    schedulerStatus.totalErrors /
                      Math.max(schedulerStatus.totalProspectsProcessed, 1)) *
                  100
                }
                className="h-2"
              />
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            className="flex-1"
          >
            <ArrowClockwise className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {!featureFlags.useDemoData && (
            <>
              {schedulerStatus?.running ? (
                <Button size="sm" variant="outline" onClick={onStopScheduler} disabled={loading}>
                  <Pause className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={onStartScheduler} disabled={loading}>
                  <Play className="h-4 w-4 mr-2" />
                  Start
                </Button>
              )}

              <Button size="sm" variant="outline" onClick={onTriggerIngestion} disabled={loading}>
                <Database className="h-4 w-4 mr-2" />
                Ingest
              </Button>
            </>
          )}
        </div>

        {/* Mode Indicator */}
        {featureFlags.useDemoData && (
          <div className="text-xs text-muted-foreground pt-2 border-t">
            <div className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              <span>
                Development mode with preview data. Disable the preview-data environment flag to use
                the real pipeline.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
