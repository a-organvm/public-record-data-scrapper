import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchCoverageDashboard,
  createCoveragePreviewSnapshot,
  type CoverageDashboardSnapshot
} from '@/lib/api/health'

export interface UseCoverageDashboardOptions {
  pollIntervalMs?: number
  fallbackToPreview?: boolean
  enabled?: boolean
}

export interface UseCoverageDashboardResult {
  snapshot: CoverageDashboardSnapshot | null
  loading: boolean
  error: string | null
  lastRefreshed: Date | null
  refresh: () => Promise<void>
}

export function useCoverageDashboard(
  options: UseCoverageDashboardOptions = {}
): UseCoverageDashboardResult {
  const { pollIntervalMs = 30000, fallbackToPreview = false, enabled = true } = options

  const [snapshot, setSnapshot] = useState<CoverageDashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Keep snapshot accessible inside fetchData without making it a dependency
  const snapshotRef = useRef<CoverageDashboardSnapshot | null>(null)
  snapshotRef.current = snapshot

  const fetchData = useCallback(async () => {
    if (!enabled) return

    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      setLoading(true)
      setError(null)
      const data = await fetchCoverageDashboard(controller.signal)
      if (!controller.signal.aborted) {
        setSnapshot(data)
        setLastRefreshed(new Date())
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      const message = (err as Error).message || 'Failed to fetch coverage data'
      setError(message)

      if (fallbackToPreview && !snapshotRef.current) {
        setSnapshot(createCoveragePreviewSnapshot())
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [enabled, fallbackToPreview])

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchData()
    }
    return () => {
      abortRef.current?.abort()
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return

    intervalRef.current = setInterval(fetchData, pollIntervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, pollIntervalMs, fetchData])

  // Visibility pause
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Pause polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      } else {
        // Resume polling + immediate refresh
        fetchData()
        if (pollIntervalMs > 0) {
          intervalRef.current = setInterval(fetchData, pollIntervalMs)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchData, pollIntervalMs])

  const refresh = useCallback(async () => {
    await fetchData()
  }, [fetchData])

  return { snapshot, loading, error, lastRefreshed, refresh }
}
