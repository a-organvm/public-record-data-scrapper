import { useEffect, useMemo, useState } from 'react'
import type { DataTier } from '@public-records/core'
import {
  createCoveragePreviewSnapshot,
  fetchCoverageDashboard,
  type CoverageDashboardSnapshot,
  type CoverageStatus,
  type StateCoverageSnapshot
} from '@/lib/api/health'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import {
  ShieldCheck,
  WarningCircle,
  WarningOctagon,
  ArrowsClockwise,
  Broadcast,
  Pulse,
  LockKey
} from '@phosphor-icons/react'

interface CoverageDashboardProps {
  dataTier?: DataTier
  usePreviewData?: boolean
}

const STATUS_CLASSES: Record<CoverageStatus, string> = {
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  yellow: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  red: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const STATUS_ICONS = {
  green: ShieldCheck,
  yellow: WarningCircle,
  red: WarningOctagon
} satisfies Record<CoverageStatus, typeof ShieldCheck>

function formatTimestamp(value: string | null): string {
  if (!value) return 'Telemetry pending'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

function summarizeStrategies(state: StateCoverageSnapshot): string {
  if (!state.primaryStrategy) return 'No active strategy'
  if (!state.fallbackStrategy) return state.primaryStrategy
  return `${state.primaryStrategy} -> ${state.fallbackStrategy}`
}

function formatDisplayStrategy(value: string | null): string {
  if (!value) return 'Unassigned'
  return value.toUpperCase()
}

function formatCircuitState(
  value: StateCoverageSnapshot['telemetry']['circuitState'],
  backoffUntil: string | null
): string {
  if (value === 'closed') return 'Closed'
  if (value === 'half-open') return 'Half-open'
  return backoffUntil ? `Open until ${formatTimestamp(backoffUntil)}` : 'Open'
}

function SummaryTile({
  label,
  value,
  status
}: {
  label: string
  value: number
  status: CoverageStatus
}) {
  const Icon = STATUS_ICONS[status]

  return (
    <div className={`rounded-2xl border px-4 py-3 ${STATUS_CLASSES[status]}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Icon size={18} weight="fill" />
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
    </div>
  )
}

function StateCard({ state }: { state: StateCoverageSnapshot }) {
  const StatusIcon = STATUS_ICONS[state.status]

  return (
    <div className={`rounded-2xl border p-4 ${STATUS_CLASSES[state.status]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusIcon size={18} weight="fill" />
            <span className="text-lg font-semibold tracking-tight">{state.stateCode}</span>
          </div>
          <p className="mt-1 text-sm text-white/80">{state.stateName}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {state.isHighValue && (
            <Badge variant="outline" className="border-white/20 bg-white/10 text-white">
              High value
            </Badge>
          )}
          {state.vendorInsuranceEnabled && (
            <Badge className="bg-sky-500/90 text-white shadow-none">Insured</Badge>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/70">Status</span>
          <span className="font-medium">{state.statusReason}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/70">Strategy</span>
          <span className="font-medium uppercase">
            {formatDisplayStrategy(state.telemetry.currentStrategy ?? summarizeStrategies(state))}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/70">Last pull</span>
          <span className="font-medium">{formatTimestamp(state.telemetry.lastSuccessfulPull)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/70">Circuit</span>
          <span className="font-medium">
            {formatCircuitState(state.telemetry.circuitState, state.telemetry.circuitBackoffUntil)}
          </span>
        </div>
        {state.telemetry.escalationCount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-white/70">Self-heal</span>
            <span className="font-medium">
              {state.telemetry.escalationCount} escalation
              {state.telemetry.escalationCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {state.scheduled && (
          <Badge variant="outline" className="border-white/15 bg-white/10 text-white/80">
            Scheduled
          </Badge>
        )}
        {state.implemented && (
          <Badge variant="outline" className="border-white/15 bg-white/10 text-white/80">
            Implemented
          </Badge>
        )}
        {!state.implemented && (
          <Badge variant="outline" className="border-white/15 bg-white/10 text-white/80">
            Build queue
          </Badge>
        )}
        {state.telemetry.circuitState !== 'closed' && (
          <Badge variant="outline" className="border-amber-400/30 bg-amber-500/10 text-amber-200">
            {state.telemetry.circuitState === 'open' ? 'Circuit open' : 'Recovery probe'}
          </Badge>
        )}
      </div>

      <p className="mt-4 text-xs leading-5 text-white/75">{state.notes[0]}</p>
    </div>
  )
}

export function CoverageDashboard({
  dataTier = 'oss',
  usePreviewData = false
}: CoverageDashboardProps) {
  const [snapshot, setSnapshot] = useState<CoverageDashboardSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadCoverage() {
      setIsLoading(true)
      setError(null)

      try {
        if (usePreviewData) {
          setSnapshot(createCoveragePreviewSnapshot(dataTier))
          return
        }

        const result = await fetchCoverageDashboard(controller.signal, { dataTier })
        setSnapshot(result)
      } catch (loadError) {
        if (controller.signal.aborted) return

        setError(loadError instanceof Error ? loadError.message : 'Failed to load coverage status')
        setSnapshot(null)
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadCoverage()
    return () => controller.abort()
  }, [dataTier, reloadToken, usePreviewData])

  const groupedStates = useMemo(() => {
    if (!snapshot) {
      return { highValue: [], remaining: [] }
    }

    const sortedStates = [...snapshot.states].sort((left, right) => {
      if (left.isHighValue !== right.isHighValue) return left.isHighValue ? -1 : 1
      if (left.status !== right.status) {
        const rank = { green: 0, yellow: 1, red: 2 }
        return rank[left.status] - rank[right.status]
      }
      return left.stateCode.localeCompare(right.stateCode)
    })

    return {
      highValue: sortedStates.filter((state) => state.isHighValue),
      remaining: sortedStates.filter((state) => !state.isHighValue)
    }
  }, [snapshot])

  if (isLoading && !snapshot) {
    return (
      <Card className="glass-effect border-white/10">
        <CardHeader>
          <CardTitle>Coverage Dashboard</CardTitle>
          <CardDescription>Loading 50-state readiness snapshot...</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!snapshot) {
    return (
      <Card className="glass-effect border-rose-500/20">
        <CardHeader>
          <CardTitle>Coverage Dashboard</CardTitle>
          <CardDescription>
            Live coverage telemetry is unavailable. Synthetic fallback is disabled for this view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error ?? 'Coverage endpoint did not return a snapshot.'}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="glass-effect border-white/10">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Broadcast size={20} weight="fill" className="text-primary" />
                <CardTitle>Coverage Dashboard</CardTitle>
              </div>
              <CardDescription>
                Operational readiness snapshot for the 50-state scraper footprint. This is the first
                Phase 1 artifact for Tony&apos;s green/yellow/red status page.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/10 text-white/80">
                {snapshot.mode === 'readiness' ? 'Readiness mode' : snapshot.mode}
              </Badge>
              <Badge variant="outline" className="border-white/15 bg-white/10 text-white/80">
                Tier {snapshot.tier}
              </Badge>
              {snapshot.insuranceProvider && (
                <Badge className="bg-sky-500/90 text-white shadow-none">
                  Insurance {snapshot.insuranceProvider}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Live refresh failed. Showing the most recent coverage snapshot: {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            <SummaryTile label="Green states" value={snapshot.summary.greenStates} status="green" />
            <SummaryTile
              label="Yellow states"
              value={snapshot.summary.yellowStates}
              status="yellow"
            />
            <SummaryTile label="Red states" value={snapshot.summary.redStates} status="red" />
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-white/80">High-value operational</span>
                <Pulse size={18} weight="fill" className="text-primary" />
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">
                {snapshot.summary.highValueOperationalStates}/4
              </div>
              <p className="mt-2 text-xs text-white/60">
                {snapshot.summary.highValueProtectedStates}/4 protected by vendor insurance
              </p>
              <p className="mt-1 text-xs text-white/60">
                {snapshot.summary.openCircuitStates} open circuit
                {snapshot.summary.openCircuitStates === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white/80">
                <ArrowsClockwise size={16} weight="bold" className="text-primary" />
                Automatic fallback
              </div>
              <p className="mt-2 text-sm text-white/70">
                Fallback routing is enabled. {snapshot.summary.statesWithEscalations} state
                {snapshot.summary.statesWithEscalations === 1 ? '' : 's'} have already escalated,
                and {snapshot.summary.implementedStates} of {snapshot.summary.totalStates} states
                currently have an implementation to fail over from.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {groupedStates.highValue.map((state) => (
                  <Badge
                    key={state.stateCode}
                    variant="outline"
                    className={`border ${STATUS_CLASSES[state.status]}`}
                  >
                    {state.stateCode}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white/80">
                <LockKey size={16} weight="fill" className="text-primary" />
                Next build steps
              </div>
              <ul className="mt-3 space-y-2 text-sm text-white/70">
                {snapshot.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">High-value states</h3>
          {!usePreviewData && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              Refresh snapshot
            </Button>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {groupedStates.highValue.map((state) => (
            <StateCard key={state.stateCode} state={state} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">All states</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groupedStates.remaining.map((state) => (
            <StateCard key={state.stateCode} state={state} />
          ))}
        </div>
      </div>
    </div>
  )
}
