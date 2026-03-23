import type { DataTier } from '@public-records/core'
import { apiRequest } from './client'

export type CoverageStatus = 'green' | 'yellow' | 'red'
export type CoverageStrategy = 'api' | 'bulk' | 'vendor' | 'scrape'
export type CoverageSnapshotMode = 'readiness'

export interface StateCoverageTelemetry {
  lastSuccessfulPull: string | null
  records24h: number | null
  records7d: number | null
  records30d: number | null
  errorRate: number | null
  currentStrategy: CoverageStrategy | null
  circuitState: 'closed' | 'open' | 'half-open'
  circuitBackoffUntil: string | null
  lastEscalatedAt: string | null
  lastEscalationReason: string | null
  escalationCount: number
}

export interface StateCoverageSnapshot {
  stateCode: string
  stateName: string
  status: CoverageStatus
  statusReason: string
  isHighValue: boolean
  scheduled: boolean
  implemented: boolean
  primaryStrategy: CoverageStrategy | null
  fallbackStrategy: CoverageStrategy | null
  availableStrategies: CoverageStrategy[]
  vendorInsuranceEnabled: boolean
  telemetry: StateCoverageTelemetry
  notes: string[]
}

export interface CoverageSummary {
  totalStates: number
  greenStates: number
  yellowStates: number
  redStates: number
  implementedStates: number
  scheduledStates: number
  highValueOperationalStates: number
  highValueProtectedStates: number
  telemetryWiredStates: number
  openCircuitStates: number
  statesWithEscalations: number
}

export interface CoverageDashboardSnapshot {
  generatedAt: string
  mode: CoverageSnapshotMode
  tier: 'free-tier' | 'starter-tier'
  overallStatus: CoverageStatus
  summary: CoverageSummary
  insuranceProvider: string | null
  enabledIntegrations: string[]
  automaticFallbackEnabled: boolean
  nextActions: string[]
  states: StateCoverageSnapshot[]
}

type StateDefinition = {
  code: string
  name: string
}

const HIGH_VALUE_STATES = new Set(['CA', 'TX', 'FL', 'NY'])
const SCHEDULED_STATES = new Set(['NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'])

function createEmptyTelemetry(strategy: CoverageStrategy | null): StateCoverageTelemetry {
  return {
    lastSuccessfulPull: null,
    records24h: null,
    records7d: null,
    records30d: null,
    errorRate: null,
    currentStrategy: strategy,
    circuitState: 'closed',
    circuitBackoffUntil: null,
    lastEscalatedAt: null,
    lastEscalationReason: null,
    escalationCount: 0
  }
}

const US_STATES: StateDefinition[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' }
]

const IMPLEMENTED_STATE_MAP: Partial<
  Record<string, Omit<StateCoverageSnapshot, 'stateCode' | 'stateName'>>
> = {
  CA: {
    status: 'green',
    statusReason: 'Operational with fallback',
    isHighValue: true,
    scheduled: true,
    implemented: true,
    primaryStrategy: 'api',
    fallbackStrategy: 'scrape',
    availableStrategies: ['api', 'scrape'],
    vendorInsuranceEnabled: false,
    telemetry: createEmptyTelemetry('api'),
    notes: [
      'Collector supports API-first collection with scraper fallback.',
      'Runtime telemetry is currently in-memory until it is persisted.'
    ]
  },
  TX: {
    status: 'yellow',
    statusReason: 'Partial coverage',
    isHighValue: true,
    scheduled: true,
    implemented: true,
    primaryStrategy: 'bulk',
    fallbackStrategy: 'scrape',
    availableStrategies: ['bulk', 'scrape'],
    vendorInsuranceEnabled: false,
    telemetry: createEmptyTelemetry('bulk'),
    notes: [
      'Bulk ingestion exists, but state-level telemetry and audit coverage are not wired yet.',
      'Runtime telemetry is currently in-memory until it is persisted.'
    ]
  },
  FL: {
    status: 'red',
    statusReason: 'Blocked pending external dependency',
    isHighValue: true,
    scheduled: true,
    implemented: true,
    primaryStrategy: 'vendor',
    fallbackStrategy: null,
    availableStrategies: ['vendor'],
    vendorInsuranceEnabled: false,
    telemetry: createEmptyTelemetry('vendor'),
    notes: [
      'Vendor-backed access requires an active commercial data agreement before it is operational.',
      'Runtime telemetry is currently in-memory until it is persisted.'
    ]
  },
  NY: {
    status: 'yellow',
    statusReason: 'Partial coverage',
    isHighValue: true,
    scheduled: true,
    implemented: true,
    primaryStrategy: 'scrape',
    fallbackStrategy: null,
    availableStrategies: ['scrape'],
    vendorInsuranceEnabled: false,
    telemetry: createEmptyTelemetry('scrape'),
    notes: [
      'Scrape-only access works, but it remains fragile until proxy rotation and CAPTCHA handling land.',
      'Runtime telemetry is currently in-memory until it is persisted.'
    ]
  }
}

export async function fetchCoverageDashboard(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<CoverageDashboardSnapshot> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  return apiRequest<CoverageDashboardSnapshot>('/health/coverage', { signal, headers })
}

export function createCoveragePreviewSnapshot(
  dataTier: DataTier = 'oss'
): CoverageDashboardSnapshot {
  const paidTier = dataTier === 'paid'
  const states = US_STATES.map((state) => {
    const implementedState = IMPLEMENTED_STATE_MAP[state.code]
    const vendorInsuranceEnabled = paidTier && HIGH_VALUE_STATES.has(state.code)

    if (!implementedState) {
      const notes = ['No collector implementation is registered for this state yet.']

      if (SCHEDULED_STATES.has(state.code)) {
        notes.push(
          'The scheduler references this state, but the collector implementation has not been built.'
        )
      }

      if (HIGH_VALUE_STATES.has(state.code) && !vendorInsuranceEnabled) {
        notes.push('High-value state is missing vendor feed insurance.')
      }

      return {
        stateCode: state.code,
        stateName: state.name,
        status: 'red',
        statusReason: 'Not implemented',
        isHighValue: HIGH_VALUE_STATES.has(state.code),
        scheduled: SCHEDULED_STATES.has(state.code),
        implemented: false,
        primaryStrategy: null,
        fallbackStrategy: null,
        availableStrategies: [],
        vendorInsuranceEnabled,
        telemetry: createEmptyTelemetry(null),
        notes
      } satisfies StateCoverageSnapshot
    }

    return {
      ...implementedState,
      stateCode: state.code,
      stateName: state.name,
      vendorInsuranceEnabled
    } satisfies StateCoverageSnapshot
  })

  const simulatedTxRecovery = states.find((state) => state.stateCode === 'TX')
  if (simulatedTxRecovery) {
    simulatedTxRecovery.status = 'yellow'
    simulatedTxRecovery.statusReason = 'Escalating from bulk to scrape after portal timeout'
    simulatedTxRecovery.telemetry = {
      ...simulatedTxRecovery.telemetry,
      currentStrategy: 'scrape',
      circuitState: 'open',
      circuitBackoffUntil: '2026-03-23T14:30:00.000Z',
      lastEscalatedAt: '2026-03-23T14:26:00.000Z',
      lastEscalationReason: 'Escalating from bulk to scrape after portal timeout',
      escalationCount: 1
    }
    simulatedTxRecovery.notes = [
      ...simulatedTxRecovery.notes,
      'Self-healing escalated from bulk to scrape after a recoverable timeout.'
    ]
  }

  const summary: CoverageSummary = {
    totalStates: states.length,
    greenStates: states.filter((state) => state.status === 'green').length,
    yellowStates: states.filter((state) => state.status === 'yellow').length,
    redStates: states.filter((state) => state.status === 'red').length,
    implementedStates: states.filter((state) => state.implemented).length,
    scheduledStates: states.filter((state) => state.scheduled).length,
    highValueOperationalStates: states.filter(
      (state) => state.isHighValue && state.status !== 'red'
    ).length,
    highValueProtectedStates: states.filter(
      (state) => state.isHighValue && state.vendorInsuranceEnabled
    ).length,
    telemetryWiredStates: 0,
    openCircuitStates: states.filter((state) => state.telemetry.circuitState === 'open').length,
    statesWithEscalations: states.filter((state) => state.telemetry.escalationCount > 0).length
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'readiness',
    tier: paidTier ? 'starter-tier' : 'free-tier',
    overallStatus: 'red',
    summary,
    insuranceProvider: paidTier ? 'ctcorp' : null,
    enabledIntegrations: paidTier ? ['uccCtCorp'] : [],
    automaticFallbackEnabled: true,
    nextActions: [
      'Persist per-state resilience telemetry so circuit state survives restarts.',
      'Enable vendor feed insurance for CA, TX, FL, and NY.',
      'Expand collectors beyond CA, TX, FL, and NY so scheduled states are not red by default.',
      'Add scheduled portal probes so self-healing reacts before full ingestion failures.'
    ],
    states
  }
}
