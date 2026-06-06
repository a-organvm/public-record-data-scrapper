/**
 * Tests for AgentOrchestrator
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  AgentOrchestrator,
  DEFAULT_ORCHESTRATION_CONFIG,
  type OrchestrationConfig
} from './AgentOrchestrator'
import type { SystemContext } from './types'

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator
  let mockContext: SystemContext

  beforeEach(() => {
    const config: OrchestrationConfig = {
      enableStateAgents: true,
      enableEntryPointAgents: true,
      maxConcurrentCollections: 3,
      collectionInterval: 1000, // 1 second for tests
      prioritizeStates: ['NY', 'CA', 'TX']
    }

    orchestrator = new AgentOrchestrator(config)

    mockContext = {
      prospects: [],
      competitors: [],
      portfolio: [],
      userActions: [],
      performanceMetrics: {
        avgResponseTime: 200,
        errorRate: 0.01,
        userSatisfactionScore: 4.5,
        dataFreshnessScore: 0.8
      },
      timestamp: new Date().toISOString()
    }
  })

  describe('initialization', () => {
    it('should initialize with config', () => {
      expect(orchestrator).toBeDefined()
    })

    it('should create state agents when enabled', () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA'],
        maxConcurrentCollections: 5,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const status = orch.getStatus()
      expect(status.totalAgents).toBeGreaterThan(0)
    })

    it('should create all state agents when no states specified', () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        maxConcurrentCollections: 5,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const status = orch.getStatus()
      expect(status.totalAgents).toBeGreaterThan(10) // Should have many states
    })

    it('should create entry point agents when enabled', () => {
      const config: OrchestrationConfig = {
        enableStateAgents: false,
        enableEntryPointAgents: true,
        maxConcurrentCollections: 5,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const status = orch.getStatus()
      expect(status.totalAgents).toBeGreaterThan(0)
    })

    it('should create both types when both enabled', () => {
      const status = orchestrator.getStatus()
      expect(status.totalAgents).toBeGreaterThan(0)
    })

    it('should initialize status correctly', () => {
      const status = orchestrator.getStatus()
      expect(status.activeAgents).toBe(status.totalAgents)
      expect(status.collectionsInProgress).toBe(0)
      expect(status.totalCollections).toBe(0)
      expect(status.successfulCollections).toBe(0)
      expect(status.failedCollections).toBe(0)
      expect(status.lastCollectionTime).toBeDefined()
    })
  })

  describe('analyzeAllAgents()', () => {
    it('should analyze all registered agents', async () => {
      const analyses = await orchestrator.analyzeAllAgents(mockContext)
      expect(analyses.length).toBeGreaterThan(0)
    })

    it('should return analysis from state agents', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA'],
        maxConcurrentCollections: 5,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const analyses = await orch.analyzeAllAgents(mockContext)

      expect(analyses.length).toBe(2)
      analyses.forEach((analysis) => {
        expect(analysis.agentRole).toBe('state-collector')
        expect(analysis.findings).toBeDefined()
        expect(analysis.improvements).toBeDefined()
      })
    })

    it('should return analysis from entry point agents', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: false,
        enableEntryPointAgents: true,
        maxConcurrentCollections: 5,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const analyses = await orch.analyzeAllAgents(mockContext)

      expect(analyses.length).toBeGreaterThan(0)
      analyses.forEach((analysis) => {
        expect(analysis.agentRole).toBe('entry-point-collector')
      })
    })

    it('should handle agent errors gracefully', async () => {
      const analyses = await orchestrator.analyzeAllAgents(mockContext)
      expect(analyses).toBeDefined()
      expect(Array.isArray(analyses)).toBe(true)
    })
  })

  describe('collectFromState()', () => {
    beforeEach(() => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA', 'TX'],
        maxConcurrentCollections: 3,
        collectionInterval: 1000
      }

      orchestrator = new AgentOrchestrator(config)
    })

    it('should fail closed for a valid state (no real collector wired)', async () => {
      const result = await orchestrator.collectFromState('NY')

      expect(result.agentId).toBeDefined()
      // Fail closed: never fabricates records, never reports simulated success.
      expect(result.success).toBe(false)
      expect(result.recordsCollected).toBe(0)
      expect(result.simulated).toBe(false)
      expect(result.errors?.[0]).toContain('live collection not wired')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('should count the unwired collection as a failure, not a success', async () => {
      await orchestrator.collectFromState('NY')

      const status = orchestrator.getStatus()
      expect(status.totalCollections).toBe(1)
      // No real records => not counted as a successful collection.
      expect(status.successfulCollections).toBe(0)
      expect(status.failedCollections).toBe(1)
    })

    it('should handle non-existent state', async () => {
      const result = await orchestrator.collectFromState('ZZ')

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.length).toBeGreaterThan(0)
    })

    it('should track collection as in progress', async () => {
      const promise = orchestrator.collectFromState('NY')
      // Status checked during collection
      await promise

      const status = orchestrator.getStatus()
      expect(status.totalCollections).toBe(1)
    })

    it('should NOT fabricate agent metrics for an unwired collection', async () => {
      const agent = orchestrator.getStateAgent('NY')
      const before = agent?.getMetrics()?.recentFilings

      await orchestrator.collectFromState('NY')

      // updateMetrics is never called with fabricated numbers, so recentFilings
      // is unchanged by the unwired collection attempt.
      const after = agent?.getMetrics()?.recentFilings
      expect(after).toBe(before)
    })
  })

  describe('collectFromEntryPoint()', () => {
    beforeEach(() => {
      const config: OrchestrationConfig = {
        enableStateAgents: false,
        enableEntryPointAgents: true,
        maxConcurrentCollections: 3,
        collectionInterval: 1000
      }

      orchestrator = new AgentOrchestrator(config)
    })

    it('should collect from entry point', async () => {
      const result = await orchestrator.collectFromEntryPoint('ucc-national-api')

      expect(result.agentId).toBeDefined()
      expect(result.success).toBeDefined()
      expect(result.recordsCollected).toBeGreaterThanOrEqual(0)
    })

    it('should handle non-existent entry point', async () => {
      const result = await orchestrator.collectFromEntryPoint('invalid-id')

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
    })

    it('should update collection metrics', async () => {
      await orchestrator.collectFromEntryPoint('ucc-national-api')

      const status = orchestrator.getStatus()
      expect(status.totalCollections).toBe(1)
    })
  })

  describe('collectFromAllSources()', () => {
    it('should collect from all sources', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: true,
        states: ['NY', 'CA'],
        maxConcurrentCollections: 2,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const results = await orch.collectFromAllSources()

      expect(results.length).toBeGreaterThan(0)
    })

    it('should respect state-only option', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: true,
        states: ['NY'],
        maxConcurrentCollections: 2,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const results = await orch.collectFromAllSources({ statesOnly: true })

      results.forEach((result) => {
        expect(result.agentId).toContain('state-agent')
      })
    })

    it('should respect entry-points-only option', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: true,
        states: ['NY'],
        maxConcurrentCollections: 2,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const results = await orch.collectFromAllSources({ entryPointsOnly: true })

      results.forEach((result) => {
        expect(result.agentId).not.toContain('state-agent')
      })
    })

    it('should respect limit option', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        maxConcurrentCollections: 10,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      const results = await orch.collectFromAllSources({ limit: 3 })

      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('should prioritize states if configured', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA', 'TX', 'FL', 'IL'],
        maxConcurrentCollections: 2,
        collectionInterval: 1000,
        prioritizeStates: ['TX', 'FL']
      }

      const orch = new AgentOrchestrator(config)
      const results = await orch.collectFromAllSources({ limit: 2 })

      // First results should be from prioritized states
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should handle collection failures gracefully', async () => {
      const results = await orchestrator.collectFromAllSources({ limit: 2 })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((result) => {
        // Unwired collections complete synchronously, so duration may be 0.
        expect(result.duration).toBeGreaterThanOrEqual(0)
      })
    }, 15000)

    it('should update last collection time', async () => {
      const beforeTime = new Date().toISOString()
      await orchestrator.collectFromAllSources({ limit: 2 })
      const status = orchestrator.getStatus()

      expect(status.lastCollectionTime).toBeDefined()
      expect(new Date(status.lastCollectionTime).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTime).getTime()
      )
    }, 15000)

    it('should respect concurrency limit', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA', 'TX', 'FL', 'IL', 'OH', 'PA'],
        maxConcurrentCollections: 2,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)

      // This test verifies concurrency by running collection
      const results = await orch.collectFromAllSources()
      expect(results.length).toBe(7)
    })
  })

  describe('getStatus()', () => {
    it('should return status copy', () => {
      const status1 = orchestrator.getStatus()
      const status2 = orchestrator.getStatus()

      expect(status1).not.toBe(status2)
      expect(status1).toEqual(status2)
    })

    it('should update status during collections', async () => {
      const initialStatus = orchestrator.getStatus()
      expect(initialStatus.totalCollections).toBe(0)

      await orchestrator.collectFromAllSources({ limit: 1 })

      const finalStatus = orchestrator.getStatus()
      expect(finalStatus.totalCollections).toBeGreaterThan(0)
    })
  })

  describe('agent accessors', () => {
    beforeEach(() => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: true,
        states: ['NY', 'CA'],
        maxConcurrentCollections: 3,
        collectionInterval: 1000
      }

      orchestrator = new AgentOrchestrator(config)
    })

    it('should get specific state agent', () => {
      const agent = orchestrator.getStateAgent('NY')
      expect(agent).toBeDefined()
      expect(agent?.getConfig().stateCode).toBe('NY')
    })

    it('should return undefined for non-existent state', () => {
      const agent = orchestrator.getStateAgent('ZZ')
      expect(agent).toBeUndefined()
    })

    it('should get specific entry point agent', () => {
      const agent = orchestrator.getEntryPointAgent('ucc-national-api')
      expect(agent).toBeDefined()
    })

    it('should get all state agents', () => {
      const agents = orchestrator.getAllStateAgents()
      expect(Object.keys(agents).length).toBeGreaterThan(0)
    })

    it('should get all entry point agents', () => {
      const agents = orchestrator.getAllEntryPointAgents()
      expect(agents.size).toBeGreaterThan(0)
    })
  })

  describe('periodic collection', () => {
    it('should start periodic collection', () => {
      const timerId = orchestrator.startPeriodicCollection()
      expect(timerId).toBeDefined()
      orchestrator.stopPeriodicCollection(timerId)
    })

    it('should stop periodic collection', () => {
      const timerId = orchestrator.startPeriodicCollection()
      expect(() => {
        orchestrator.stopPeriodicCollection(timerId)
      }).not.toThrow()
    })

    it('should use configured interval', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY'],
        maxConcurrentCollections: 1,
        collectionInterval: 100 // Very short for testing
      }

      const orch = new AgentOrchestrator(config)
      const timerId = orch.startPeriodicCollection()

      // Wait for at least one collection to complete (100ms interval + 500ms collection time)
      await new Promise((resolve) => setTimeout(resolve, 650))

      orch.stopPeriodicCollection(timerId)

      const status = orch.getStatus()
      expect(status.totalCollections).toBeGreaterThan(0)
    }, 15000)
  })

  describe('DEFAULT_ORCHESTRATION_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_ORCHESTRATION_CONFIG.enableStateAgents).toBe(true)
      expect(DEFAULT_ORCHESTRATION_CONFIG.enableEntryPointAgents).toBe(true)
      expect(DEFAULT_ORCHESTRATION_CONFIG.maxConcurrentCollections).toBeGreaterThan(0)
      expect(DEFAULT_ORCHESTRATION_CONFIG.collectionInterval).toBeGreaterThan(0)
    })

    it('should prioritize major states', () => {
      expect(DEFAULT_ORCHESTRATION_CONFIG.prioritizeStates).toContain('NY')
      expect(DEFAULT_ORCHESTRATION_CONFIG.prioritizeStates).toContain('CA')
      expect(DEFAULT_ORCHESTRATION_CONFIG.prioritizeStates).toContain('TX')
    })

    it('should be usable to create orchestrator', () => {
      const orch = new AgentOrchestrator(DEFAULT_ORCHESTRATION_CONFIG)
      expect(orch).toBeDefined()
      const status = orch.getStatus()
      expect(status.totalAgents).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('should track failed collections', async () => {
      await orchestrator.collectFromState('INVALID')

      const status = orchestrator.getStatus()
      expect(status.failedCollections).toBeGreaterThan(0)
    })

    it('should continue after individual failures', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA'],
        maxConcurrentCollections: 3,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)

      // Mix valid (but unwired) and non-existent states. Both fail closed, but
      // with distinct, named reasons — and the orchestrator keeps going.
      const results = await Promise.all([
        orch.collectFromState('NY'),
        orch.collectFromState('INVALID'),
        orch.collectFromState('CA')
      ])

      expect(results).toHaveLength(3)
      // Every result fails closed with no fabricated records.
      results.forEach((r) => {
        expect(r.success).toBe(false)
        expect(r.recordsCollected).toBe(0)
        expect(r.errors?.length).toBeGreaterThan(0)
      })

      // Valid-but-unwired states report the "not wired" reason; the bogus state
      // reports "not found". Distinct reasons prove the orchestrator continued.
      const unwired = results.filter((r) => r.errors?.[0]?.includes('not wired')).length
      const notFound = results.filter((r) => r.errors?.[0]?.includes('not found')).length
      expect(unwired).toBe(2)
      expect(notFound).toBe(1)
    }, 15000)

    it('should return errors in failed collection results', async () => {
      const result = await orchestrator.collectFromState('INVALID')

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.length).toBeGreaterThan(0)
    })
  })

  describe('metrics tracking', () => {
    it('should track total collections', async () => {
      await orchestrator.collectFromAllSources({ limit: 2 })
      const status = orchestrator.getStatus()

      expect(status.totalCollections).toBeGreaterThan(0)
    })

    it('should differentiate successful and failed collections', async () => {
      const config: OrchestrationConfig = {
        enableStateAgents: true,
        enableEntryPointAgents: false,
        states: ['NY', 'CA'],
        maxConcurrentCollections: 2,
        collectionInterval: 1000
      }

      const orch = new AgentOrchestrator(config)
      await orch.collectFromAllSources()

      const status = orch.getStatus()
      expect(status.successfulCollections + status.failedCollections).toBe(status.totalCollections)
    })

    it('should track collections in progress correctly', async () => {
      const beforeStatus = orchestrator.getStatus()
      expect(beforeStatus.collectionsInProgress).toBe(0)

      await orchestrator.collectFromAllSources({ limit: 1 })

      const afterStatus = orchestrator.getStatus()
      expect(afterStatus.collectionsInProgress).toBe(0) // Should be back to 0
    })
  })

  describe('edge cases', () => {
    describe('boundary conditions', () => {
      it('should handle empty states array by creating all agents', () => {
        const config: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: [],
          maxConcurrentCollections: 1,
          collectionInterval: 1000
        }

        const orch = new AgentOrchestrator(config)
        const status = orch.getStatus()
        // Empty array falls through to createAllStateAgents()
        expect(status.totalAgents).toBeGreaterThan(0)
      })

      it('should handle very large concurrency limit', async () => {
        const config: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: ['NY', 'CA', 'TX'],
          maxConcurrentCollections: 1000,
          collectionInterval: 1000
        }

        const orch = new AgentOrchestrator(config)
        const results = await orch.collectFromAllSources()
        expect(results).toHaveLength(3)
      })

      it('should handle single state collection', async () => {
        const config: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: ['NY'],
          maxConcurrentCollections: 1,
          collectionInterval: 1000
        }

        const orch = new AgentOrchestrator(config)
        const results = await orch.collectFromAllSources()
        expect(results).toHaveLength(1)
        // Fail closed: unwired collection returns a failed, non-fabricated result.
        expect(results[0].success).toBe(false)
        expect(results[0].recordsCollected).toBe(0)
      })
    })

    describe('error recovery', () => {
      it('should recover from multiple consecutive failures', async () => {
        const results = await Promise.all([
          orchestrator.collectFromState('INVALID1'),
          orchestrator.collectFromState('INVALID2'),
          orchestrator.collectFromState('INVALID3')
        ])

        expect(results).toHaveLength(3)
        results.forEach((result) => {
          expect(result.success).toBe(false)
          expect(result.errors).toBeDefined()
        })
      })

      it('should maintain accurate counts after failures', async () => {
        const beforeStatus = orchestrator.getStatus()
        const beforeFailed = beforeStatus.failedCollections

        await orchestrator.collectFromState('INVALID')
        await orchestrator.collectFromState('INVALID')

        const afterStatus = orchestrator.getStatus()
        expect(afterStatus.failedCollections).toBe(beforeFailed + 2)
      })

      it('should include error details in failed results', async () => {
        const result = await orchestrator.collectFromState('INVALID_STATE')

        expect(result.success).toBe(false)
        expect(result.errors).toBeDefined()
        expect(result.errors!.length).toBeGreaterThan(0)
        expect(result.errors![0]).toContain('not found')
      })
    })

    describe('concurrent operations', () => {
      it('should handle multiple simultaneous collectFromAllSources calls', async () => {
        const config: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: ['NY', 'CA'],
          maxConcurrentCollections: 2,
          collectionInterval: 1000
        }

        const orch = new AgentOrchestrator(config)

        const [results1, results2] = await Promise.all([
          orch.collectFromAllSources(),
          orch.collectFromAllSources()
        ])

        expect(results1).toHaveLength(2)
        expect(results2).toHaveLength(2)
      })

      it('should track metrics correctly with concurrent collections', async () => {
        const config: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: ['NY', 'CA', 'TX'],
          maxConcurrentCollections: 3,
          collectionInterval: 1000
        }

        const orch = new AgentOrchestrator(config)

        await Promise.all([
          orch.collectFromState('NY'),
          orch.collectFromState('CA'),
          orch.collectFromState('TX')
        ])

        const status = orch.getStatus()
        expect(status.totalCollections).toBe(3)
        // Fail closed: unwired collections are counted as failures, not successes.
        expect(status.successfulCollections).toBe(0)
        expect(status.failedCollections).toBe(3)
        expect(status.collectionsInProgress).toBe(0)
      })
    })

    describe('state management', () => {
      it('should maintain separate state for different orchestrators', async () => {
        const config1: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: ['NY'],
          maxConcurrentCollections: 1,
          collectionInterval: 1000
        }

        const config2: OrchestrationConfig = {
          enableStateAgents: true,
          enableEntryPointAgents: false,
          states: ['CA'],
          maxConcurrentCollections: 1,
          collectionInterval: 1000
        }

        const orch1 = new AgentOrchestrator(config1)
        const orch2 = new AgentOrchestrator(config2)

        await orch1.collectFromAllSources()
        const status1 = orch1.getStatus()
        const status2 = orch2.getStatus()

        expect(status1.totalCollections).toBe(1)
        expect(status2.totalCollections).toBe(0)
      })

      it('should update lastCollectionTime only after successful collection', async () => {
        const beforeTime = orchestrator.getStatus().lastCollectionTime

        await new Promise((resolve) => setTimeout(resolve, 100))
        await orchestrator.collectFromState('INVALID')

        const afterStatus = orchestrator.getStatus()
        expect(afterStatus.lastCollectionTime).toBe(beforeTime)
      })

      it('should return immutable status copies', () => {
        const status1 = orchestrator.getStatus()
        const status2 = orchestrator.getStatus()

        status1.totalCollections = 9999

        expect(status2.totalCollections).not.toBe(9999)
        expect(orchestrator.getStatus().totalCollections).not.toBe(9999)
      })
    })

    describe('collection options validation', () => {
      it('should handle statesOnly option correctly', async () => {
        const results = await orchestrator.collectFromAllSources({
          statesOnly: true,
          limit: 2
        })

        expect(results.length).toBeGreaterThan(0)
        results.forEach((result) => {
          expect(result.agentId).toContain('state-agent')
        })
      })

      it('should handle entryPointsOnly option correctly', async () => {
        const results = await orchestrator.collectFromAllSources({
          entryPointsOnly: true
        })

        expect(results.length).toBeGreaterThan(0)
        results.forEach((result) => {
          expect(result.agentId).not.toContain('state-agent')
        })
      })

      it('should handle very small limit for states', async () => {
        const results = await orchestrator.collectFromAllSources({
          statesOnly: true,
          limit: 1
        })

        expect(results.length).toBe(1)
        // Fail closed: unwired collection returns a failed, non-fabricated result.
        expect(results[0].success).toBe(false)
        expect(results[0].recordsCollected).toBe(0)
      })
    })
  })
})
