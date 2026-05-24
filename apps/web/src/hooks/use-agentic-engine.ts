/**
 * React Hook for Agentic Engine
 *
 * Provides React integration for the agentic system
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { AgenticEngine } from '@/lib/agentic/AgenticEngine'
import { AgentCallbackClient } from '@/lib/agentic/AgentCallbackClient'
import { SystemContext, Improvement, ImprovementStatus, AgenticConfig } from '@/lib/agentic/types'
import { usePersistentState } from './usePersistentState'

export interface UseAgenticEngineResult {
  engine: AgenticEngine | null
  isRunning: boolean
  improvements: Improvement[]
  runCycle: () => Promise<void>
  approveImprovement: (id: string) => Promise<void>
  getImprovementsByStatus: (status: ImprovementStatus) => Improvement[]
  systemHealth: ReturnType<AgenticEngine['getSystemHealth']>
}

export interface UseAgenticEngineOptions {
  callbackClient?: AgentCallbackClient
}

export function useAgenticEngine(
  context: SystemContext,
  config?: Partial<AgenticConfig>,
  options?: UseAgenticEngineOptions
): UseAgenticEngineResult {
  const [engine] = useState(
    () => new AgenticEngine(config, { callbackClient: options?.callbackClient })
  )
  const [isRunning, setIsRunning] = useState(false)
  const [improvements, setImprovements] = usePersistentState<Improvement[]>(
    'agentic-improvements',
    []
  )
  const [lastRunTime, setLastRunTime] = usePersistentState<string>('agentic-last-run', '')
  const [systemHealth, setSystemHealth] = useState(engine.getSystemHealth())

  // Guards against the auto-run effect double-firing (e.g. when context
  // identity changes before the persisted lastRunTime has been written back).
  const autoRunStartedRef = useRef(false)
  // Ensures the one-time rehydration of persisted improvements only happens once.
  const rehydratedRef = useRef(false)

  // Rehydrate the engine's internal improvement map from persisted state on
  // init so approveImprovement() does not throw "not found" after a reload.
  if (!rehydratedRef.current) {
    rehydratedRef.current = true
    if (improvements.length > 0) {
      engine.setImprovements(improvements)
    }
  }

  // Apply configuration changes to the existing engine instead of recreating
  // it. The engine is created once (above) with the initial config; subsequent
  // config changes are forwarded via updateConfig so they are not ignored.
  // Serialize the config so the effect only fires on actual value changes.
  const configKey = config ? JSON.stringify(config) : ''
  useEffect(() => {
    if (config) {
      engine.updateConfig(config)
      setSystemHealth(engine.getSystemHealth())
    }
    // configKey captures the meaningful change; config object identity is not
    // a reliable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, configKey])

  useEffect(() => {
    engine.setCallbackClient(options?.callbackClient ?? null)
    return () => {
      engine.setCallbackClient(null)
    }
  }, [engine, options?.callbackClient])

  // Run autonomous cycle
  const runCycle = useCallback(async () => {
    if (isRunning) return

    setIsRunning(true)
    try {
      const result = await engine.runAutonomousCycle(context)
      setImprovements(engine.getImprovements())
      setLastRunTime(new Date().toISOString())
      setSystemHealth(engine.getSystemHealth())

      console.log('✅ Autonomous cycle completed', result)
    } catch (error) {
      console.error('❌ Autonomous cycle failed:', error)
    } finally {
      setIsRunning(false)
    }
  }, [context, engine, isRunning, setImprovements, setLastRunTime])

  // Approve and execute an improvement
  const approveImprovement = useCallback(
    async (id: string) => {
      try {
        await engine.approveAndExecute(id, context)
        setImprovements(engine.getImprovements())
        setSystemHealth(engine.getSystemHealth())
      } catch (error) {
        console.error('❌ Failed to approve improvement:', error)
        throw error
      }
    },
    [context, engine, setImprovements]
  )

  // Get improvements by status
  const getImprovementsByStatus = useCallback(
    (status: ImprovementStatus) => {
      return engine.getImprovementsByStatus(status)
    },
    [engine]
  )

  useEffect(() => {
    const hasProspects = context.prospects.length > 0
    const shouldAutoRun =
      !autoRunStartedRef.current && !lastRunTime && engine.getConfig().enabled && hasProspects

    if (shouldAutoRun) {
      // Latch immediately (synchronously) so a re-render triggered by a context
      // change before `lastRunTime` is persisted cannot kick off a second cycle.
      autoRunStartedRef.current = true
      console.log('🤖 Auto-running initial agentic cycle...')
      runCycle()
    }
  }, [context.prospects.length, engine, lastRunTime, runCycle])

  return {
    engine,
    isRunning,
    improvements,
    runCycle,
    approveImprovement,
    getImprovementsByStatus,
    systemHealth
  }
}
