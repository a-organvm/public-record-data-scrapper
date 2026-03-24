/**
 * Data Pipeline Hook
 *
 * React hook for integrating data ingestion and enrichment pipeline
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Prospect } from '@public-records/core'
import { DataRefreshScheduler, SchedulerStatus } from '@/lib/services'
import { featureFlags } from '@/lib/config/dataPipeline'
import { generateProspects } from '@/lib/demoData'
import { useDataTier } from '@/hooks/useDataTier'
import {
  initDatabaseService,
  fetchProspects,
  hasDatabaseData
} from '@/lib/services/databaseService'

export interface DataPipelineState {
  prospects: Prospect[]
  loading: boolean
  error: string | null
  schedulerStatus: SchedulerStatus | null
  lastUpdate: string | null
}

export interface DataPipelineActions {
  refresh: () => Promise<void>
  startScheduler: () => void
  stopScheduler: () => void
  refreshProspect: (prospectId: string) => Promise<void>
  triggerIngestion: () => Promise<void>
}

export function useDataPipeline(): DataPipelineState & DataPipelineActions {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const { dataTier } = useDataTier()

  const schedulerRef = useRef<DataRefreshScheduler | null>(null)
  const demoDataEnabled = featureFlags.useDemoData

  /**
   * Initialize data pipeline
   */
  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true)
        setError(null)

        if (demoDataEnabled) {
          console.log('Using demo data (preview mode enabled)')
          const previewProspects = generateProspects(100, { dataTier })
          setProspects(previewProspects)
          setLastUpdate(new Date().toISOString())
        } else {
          // Use database
          console.log('Initializing database connection...')

          // Initialize database service
          await initDatabaseService()

          // Check if database has data
          const hasData = await hasDatabaseData()

          if (hasData) {
            console.log('Loading prospects from database...')
            const dbProspects = await fetchProspects()
            setProspects(dbProspects)
            setLastUpdate(new Date().toISOString())
            console.log(`Loaded ${dbProspects.length} prospects from database`)
          } else {
            console.warn('No data in database. Run `npm run db:seed` to seed sample data.')
            setError('No data in database. Please seed data or switch to preview mode.')
          }
        }

        setLoading(false)
      } catch (err) {
        console.error('Failed to initialize data pipeline:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize data pipeline')
        setLoading(false)
      }
    }

    initialize()

    // Cleanup
    const scheduler = schedulerRef.current
    return () => {
      scheduler?.stop()
    }
  }, [dataTier, demoDataEnabled])

  /**
   * Manually refresh all data
   */
  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      if (demoDataEnabled) {
        const previewProspects = generateProspects(100, { dataTier })
        setProspects(previewProspects)
        setLastUpdate(new Date().toISOString())
      } else {
        // Refresh from database
        const dbProspects = await fetchProspects()
        setProspects(dbProspects)
        setLastUpdate(new Date().toISOString())
        console.log(`Refreshed ${dbProspects.length} prospects from database`)
      }

      setLoading(false)
    } catch (err) {
      console.error('Refresh failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh data')
      setLoading(false)
    }
  }, [dataTier, demoDataEnabled])

  /**
   * Start the scheduler
   */
  const startScheduler = useCallback(() => {
    if (schedulerRef.current && !demoDataEnabled) {
      schedulerRef.current.start()
      setSchedulerStatus(schedulerRef.current.getStatus())
    }
  }, [demoDataEnabled])

  /**
   * Stop the scheduler
   */
  const stopScheduler = useCallback(() => {
    if (schedulerRef.current) {
      schedulerRef.current.stop()
      setSchedulerStatus(schedulerRef.current.getStatus())
    }
  }, [])

  /**
   * Refresh a specific prospect
   */
  const refreshProspect = useCallback(
    async (prospectId: string) => {
      try {
        if (!demoDataEnabled && schedulerRef.current) {
          const refreshed = await schedulerRef.current.refreshProspect(prospectId)
          if (refreshed) {
            setProspects((prev) => prev.map((p) => (p.id === prospectId ? refreshed : p)))
            setLastUpdate(new Date().toISOString())
          }
        }
      } catch (err) {
        console.error('Failed to refresh prospect:', err)
        setError(err instanceof Error ? err.message : 'Failed to refresh prospect')
      }
    },
    [demoDataEnabled]
  )

  /**
   * Manually trigger ingestion
   */
  const triggerIngestion = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      if (!demoDataEnabled && schedulerRef.current) {
        await schedulerRef.current.triggerIngestion()
        setProspects(schedulerRef.current.getProspects())
        setSchedulerStatus(schedulerRef.current.getStatus())
        setLastUpdate(new Date().toISOString())
      }

      setLoading(false)
    } catch (err) {
      console.error('Ingestion failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to trigger ingestion')
      setLoading(false)
    }
  }, [demoDataEnabled])

  return {
    prospects,
    loading,
    error,
    schedulerStatus,
    lastUpdate,
    refresh,
    startScheduler,
    stopScheduler,
    refreshProspect,
    triggerIngestion
  }
}
