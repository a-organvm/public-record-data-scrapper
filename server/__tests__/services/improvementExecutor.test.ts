import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted mocks for the enrichment queue + collaborating services.
const mocks = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockGetEnrichmentQueue: vi.fn(),
  mockCreateAlert: vi.fn(),
  mockScoreProspect: vi.fn()
}))

vi.mock('../../queue/queues', () => ({
  getEnrichmentQueue: mocks.mockGetEnrichmentQueue
}))

import { ImprovementExecutor, type ExecutableImprovement } from '../../services/ImprovementExecutor'
import type { AlertService } from '../../services/AlertService'
import type { ScoringService } from '../../services/ScoringService'

const orgId = 'org-1'

function buildExecutor(): ImprovementExecutor {
  const alertService = { createAlert: mocks.mockCreateAlert } as unknown as AlertService
  const scoringService = { scoreProspect: mocks.mockScoreProspect } as unknown as ScoringService
  return new ImprovementExecutor({ alertService, scoringService })
}

describe('ImprovementExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockGetEnrichmentQueue.mockReturnValue({ add: mocks.mockQueueAdd })
  })

  describe('data-quality / performance', () => {
    it('enqueues a real re-enrichment job and returns the jobId', async () => {
      mocks.mockQueueAdd.mockResolvedValueOnce({ id: 'job-77' })
      const improvement: ExecutableImprovement = {
        id: 'imp-1',
        category: 'data-quality',
        title: 'Refresh stale enrichment',
        prospectIds: ['p1', 'p2']
      }

      const result = await buildExecutor().execute(improvement, orgId)

      expect(result.executed).toBe(true)
      expect(result.action).toBe('re-enrichment')
      expect(result.details).toMatchObject({ jobId: 'job-77', prospectIds: ['p1', 'p2'] })
      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        'enrich-batch',
        expect.objectContaining({ prospectIds: ['p1', 'p2'], force: true, orgId })
      )
      // No fabricated metrics.
      expect(result.details).not.toHaveProperty('metrics')
    })

    it('fails closed when no prospectIds are provided', async () => {
      const improvement: ExecutableImprovement = {
        id: 'imp-2',
        category: 'performance',
        title: 'Speed things up'
      }

      const result = await buildExecutor().execute(improvement, orgId)

      expect(result.executed).toBe(false)
      expect(result.reason).toContain('requires prospectIds')
      expect(mocks.mockQueueAdd).not.toHaveBeenCalled()
    })

    it('falls back to a real re-score when the enrichment queue is unavailable', async () => {
      mocks.mockGetEnrichmentQueue.mockImplementation(() => {
        throw new Error('Queues not initialized')
      })
      mocks.mockScoreProspect.mockResolvedValue({ score: 80 })

      const improvement: ExecutableImprovement = {
        id: 'imp-3',
        category: 'data-quality',
        title: 'Refresh scores',
        prospectIds: ['p1', 'p2']
      }

      const result = await buildExecutor().execute(improvement, orgId)

      expect(result.executed).toBe(true)
      expect(result.action).toBe('re-score')
      expect(result.details).toMatchObject({ scoredProspectIds: ['p1', 'p2'] })
      expect(mocks.mockScoreProspect).toHaveBeenCalledTimes(2)
    })

    it('fails closed when the queue is unavailable AND no prospect can be re-scored', async () => {
      mocks.mockGetEnrichmentQueue.mockImplementation(() => {
        throw new Error('Queues not initialized')
      })
      mocks.mockScoreProspect.mockRejectedValue(new Error('Prospect not found'))

      const improvement: ExecutableImprovement = {
        id: 'imp-4',
        category: 'performance',
        title: 'Refresh scores',
        prospectIds: ['ghost']
      }

      const result = await buildExecutor().execute(improvement, orgId)

      expect(result.executed).toBe(false)
      expect(result.action).toBe('re-score')
      expect(result.reason).toContain('no prospect could be re-scored')
    })
  })

  describe('security / compliance', () => {
    it('persists a real alert and returns the alertId', async () => {
      mocks.mockCreateAlert.mockResolvedValueOnce({
        id: 'alert-9',
        prospectId: 'p1',
        type: 'score_critical'
      })

      const improvement: ExecutableImprovement = {
        id: 'imp-5',
        category: 'security',
        title: 'Encrypt PII at rest',
        description: 'Sensitive fields stored unencrypted',
        prospectIds: ['p1']
      }

      const result = await buildExecutor().execute(improvement, orgId)

      expect(result.executed).toBe(true)
      expect(result.action).toBe('alert')
      expect(result.details).toMatchObject({ alertId: 'alert-9', prospectId: 'p1' })
      expect(mocks.mockCreateAlert).toHaveBeenCalledWith(
        expect.objectContaining({ orgId, prospectId: 'p1', title: 'Encrypt PII at rest' })
      )
    })

    it('fails closed when no target prospect is provided for an alert', async () => {
      const improvement: ExecutableImprovement = {
        id: 'imp-6',
        category: 'compliance',
        title: 'Disclosure gap'
      }

      const result = await buildExecutor().execute(improvement, orgId)

      expect(result.executed).toBe(false)
      expect(result.action).toBe('alert')
      expect(result.reason).toContain('requires a target prospectId')
      expect(mocks.mockCreateAlert).not.toHaveBeenCalled()
    })
  })

  describe('categories without a server-side action', () => {
    it.each(['usability', 'feature-enhancement', 'analytics', 'strategic'])(
      'fails closed for category %s',
      async (category) => {
        const improvement: ExecutableImprovement = {
          id: `imp-${category}`,
          category,
          title: 'No-op category',
          prospectIds: ['p1']
        }

        const result = await buildExecutor().execute(improvement, orgId)

        expect(result.executed).toBe(false)
        expect(result.action).toBe('none')
        expect(result.reason).toBe(`no server-side action for category ${category}`)
      }
    )
  })
})
