import { useState, useCallback, useEffect } from 'react'
import { useSafeKV as useKV } from '@/hooks/useSparkKV'
import {
  generateProspects,
  generateCompetitorData,
  generatePortfolioCompanies
} from '@/lib/mockData'
import { Prospect, CompetitorData, PortfolioCompany, DataTier } from '@public-records/core'
import { UserAction } from '@/lib/agentic/types'
import { fetchProspects } from '@/lib/api/prospects'
import { fetchCompetitors } from '@/lib/api/competitors'
import { fetchPortfolio } from '@/lib/api/portfolio'
import { fetchUserActions } from '@/lib/api/userActions'

export interface UseDataFetchingOptions {
  useMockData: boolean
  dataTier?: DataTier
}

export interface UseDataFetchingResult {
  prospects: Prospect[]
  competitors: CompetitorData[]
  portfolio: PortfolioCompany[]
  userActions: UserAction[]
  isLoading: boolean
  loadError: string | null
  lastDataRefresh: string
  setProspects: (updater: Prospect[] | ((prev: Prospect[]) => Prospect[])) => void
  setCompetitors: (
    updater: CompetitorData[] | ((prev: CompetitorData[]) => CompetitorData[])
  ) => void
  setPortfolio: (
    updater: PortfolioCompany[] | ((prev: PortfolioCompany[]) => PortfolioCompany[])
  ) => void
  setUserActions: (updater: UserAction[] | ((prev: UserAction[]) => UserAction[])) => void
  fetchData: (options?: { signal?: AbortSignal; silent?: boolean }) => Promise<boolean>
}

export function useDataFetching({
  useMockData,
  dataTier = 'oss'
}: UseDataFetchingOptions): UseDataFetchingResult {
  const [prospects, setProspects] = useKV<Prospect[]>('ucc-prospects', [])
  const [competitors, setCompetitors] = useKV<CompetitorData[]>('competitor-data', [])
  const [portfolio, setPortfolio] = useKV<PortfolioCompany[]>('portfolio-companies', [])
  const [userActions, setUserActions] = useKV<UserAction[]>('user-actions', [])
  const [lastDataRefresh, setLastDataRefresh] = useKV<string>(
    'last-data-refresh',
    new Date().toISOString()
  )

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchData = useCallback(
    async ({ signal, silent }: { signal?: AbortSignal; silent?: boolean } = {}) => {
      if (!silent) {
        setIsLoading(true)
      }
      setLoadError(null)

      const loadPreviewData = () => {
        setProspects(generateProspects(24, { dataTier }))
        setCompetitors(generateCompetitorData({ dataTier }))
        setPortfolio(generatePortfolioCompanies(15, { dataTier }))
        setLastDataRefresh(new Date().toISOString())
      }

      try {
        if (useMockData) {
          if (signal?.aborted) {
            return false
          }
          loadPreviewData()
          return true
        }

        const [liveProspects, liveCompetitors, livePortfolio, liveUserActions] = await Promise.all([
          fetchProspects(signal, { dataTier }),
          fetchCompetitors(signal, { dataTier }),
          fetchPortfolio(signal, { dataTier }),
          fetchUserActions(signal, { dataTier })
        ])

        if (signal?.aborted) {
          return false
        }

        const hasLiveData =
          liveProspects.length > 0 || liveCompetitors.length > 0 || livePortfolio.length > 0

        if (!hasLiveData) {
          // Backend reachable but empty (e.g. an unseeded DB). Show preview data
          // so the workspace is never a dead, empty shell.
          loadPreviewData()
          setLoadError(null)
          return true
        }

        setProspects(liveProspects)
        setCompetitors(liveCompetitors)
        setPortfolio(livePortfolio)
        setUserActions(liveUserActions)
        setLastDataRefresh(new Date().toISOString())
        return true
      } catch (error) {
        if (signal?.aborted) {
          return false
        }

        // Live load failed (no API/proxy/auth wired yet). Fall back to preview
        // data so the redesigned UI stays populated and demonstrable.
        console.warn('Live data unavailable; using preview dataset.', error)
        loadPreviewData()
        return true
      } finally {
        if (!silent && !signal?.aborted) {
          setIsLoading(false)
        }
      }
    },
    [
      useMockData,
      dataTier,
      setProspects,
      setCompetitors,
      setPortfolio,
      setUserActions,
      setLastDataRefresh
    ]
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetchData({ signal: controller.signal })
    return () => controller.abort()
  }, [fetchData])

  return {
    prospects: prospects || [],
    competitors: competitors || [],
    portfolio: portfolio || [],
    userActions: userActions || [],
    isLoading,
    loadError,
    lastDataRefresh: lastDataRefresh || new Date().toISOString(),
    setProspects,
    setCompetitors,
    setPortfolio,
    setUserActions,
    fetchData
  }
}
