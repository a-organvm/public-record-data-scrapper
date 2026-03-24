import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// Mock the API module
const mockFetchCoverage = vi.fn()
const mockCreatePreview = vi.fn()

vi.mock('@/lib/api/health', () => ({
  fetchCoverageDashboard: (...args: unknown[]) => mockFetchCoverage(...args),
  createCoveragePreviewSnapshot: (...args: unknown[]) => mockCreatePreview(...args)
}))

// Import hook after mocks are set up
import { useCoverageDashboard } from '../useCoverageDashboard'

describe('useCoverageDashboard', () => {
  const mockSnapshot = {
    generatedAt: new Date().toISOString(),
    mode: 'readiness' as const,
    tier: 'free-tier' as const,
    overallStatus: 'red' as const,
    summary: {
      totalStates: 51,
      greenStates: 0,
      yellowStates: 0,
      redStates: 51,
      implementedStates: 0,
      scheduledStates: 0,
      highValueOperationalStates: 0,
      highValueProtectedStates: 0,
      telemetryWiredStates: 0,
      openCircuitStates: 0,
      statesWithEscalations: 0
    },
    insuranceProvider: null,
    enabledIntegrations: [],
    automaticFallbackEnabled: false,
    nextActions: [],
    states: []
  }

  const mockPreviewSnapshot = {
    ...mockSnapshot,
    mode: 'readiness' as const,
    tier: 'starter-tier' as const
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCoverage.mockResolvedValue(mockSnapshot)
    mockCreatePreview.mockReturnValue(mockPreviewSnapshot)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns snapshot, loading, error, lastRefreshed, and refresh', async () => {
    const { result } = renderHook(() => useCoverageDashboard({ pollIntervalMs: 0 }))

    // Initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.snapshot).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.lastRefreshed).toBeNull()
    expect(typeof result.current.refresh).toBe('function')

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.snapshot).toEqual(mockSnapshot)
  })

  it('calls fetchCoverageDashboard on initial mount', async () => {
    renderHook(() => useCoverageDashboard({ pollIntervalMs: 0 }))

    await waitFor(() => {
      expect(mockFetchCoverage).toHaveBeenCalledTimes(1)
    })
  })

  it('loading starts as true and becomes false after successful fetch', async () => {
    const { result } = renderHook(() => useCoverageDashboard({ pollIntervalMs: 0 }))

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.snapshot).toEqual(mockSnapshot)
    expect(result.current.lastRefreshed).toBeInstanceOf(Date)
    expect(result.current.error).toBeNull()
  })

  it('sets error state when fetch fails', async () => {
    const errorMessage = 'Network error'
    mockFetchCoverage.mockRejectedValueOnce(new Error(errorMessage))

    const { result } = renderHook(() => useCoverageDashboard({ pollIntervalMs: 0 }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe(errorMessage)
    expect(result.current.snapshot).toBeNull()
  })

  it('manual refresh() triggers a new fetch', async () => {
    const { result } = renderHook(() => useCoverageDashboard({ pollIntervalMs: 0 }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockFetchCoverage).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockFetchCoverage).toHaveBeenCalledTimes(2)
  })

  it('falls back to preview snapshot when fallbackToPreview=true and API fails', async () => {
    mockFetchCoverage.mockRejectedValueOnce(new Error('API unavailable'))

    const { result } = renderHook(() =>
      useCoverageDashboard({ fallbackToPreview: true, pollIntervalMs: 0 })
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('API unavailable')
    expect(result.current.snapshot).toEqual(mockPreviewSnapshot)
    expect(mockCreatePreview).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when enabled=false', async () => {
    renderHook(() => useCoverageDashboard({ enabled: false, pollIntervalMs: 0 }))

    // Give React time to run any effects
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(mockFetchCoverage).not.toHaveBeenCalled()
  })

  it('polling fires fetch again after pollIntervalMs elapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      const pollIntervalMs = 30000

      renderHook(() => useCoverageDashboard({ pollIntervalMs }))

      // Wait for initial fetch to complete
      await waitFor(() => {
        expect(mockFetchCoverage).toHaveBeenCalledTimes(1)
      })

      // Advance past one polling interval
      await act(async () => {
        vi.advanceTimersByTime(pollIntervalMs)
      })

      await waitFor(() => {
        expect(mockFetchCoverage).toHaveBeenCalledTimes(2)
      })

      // Advance past a second polling interval
      await act(async () => {
        vi.advanceTimersByTime(pollIntervalMs)
      })

      await waitFor(() => {
        expect(mockFetchCoverage).toHaveBeenCalledTimes(3)
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
