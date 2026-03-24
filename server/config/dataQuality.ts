export interface StateVolumeExpectation {
  min: number
  max: number
  period: 'daily' | 'weekly'
}

export const STATE_VOLUME_EXPECTATIONS: Record<string, StateVolumeExpectation> = {
  CA: { min: 50, max: 2000, period: 'daily' },
  TX: { min: 30, max: 1500, period: 'daily' },
  FL: { min: 20, max: 1000, period: 'daily' },
  NY: { min: 40, max: 1800, period: 'daily' },
  IL: { min: 20, max: 1200, period: 'daily' },
  PA: { min: 15, max: 1000, period: 'daily' },
  OH: { min: 15, max: 800, period: 'daily' },
  GA: { min: 10, max: 600, period: 'daily' },
  NC: { min: 10, max: 500, period: 'daily' },
  MI: { min: 10, max: 500, period: 'daily' }
}

export const DEFAULT_VOLUME_EXPECTATION: StateVolumeExpectation = {
  min: 5,
  max: 500,
  period: 'daily'
}

export const FIELD_COMPLETENESS_THRESHOLD = 0.8
export const PARTY_NAME_THRESHOLD = 0.9
export const MAX_DEDUPLICATION_RATE = 0.3
export const RECENCY_WINDOW_DAYS = 30
