import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockComputeVelocity = vi.fn()
  const mockPersistMetrics = vi.fn()

  class MockFilingVelocityService {
    computeVelocity = mockComputeVelocity
    persistMetrics = mockPersistMetrics
  }

  return {
    mockComputeVelocity,
    mockPersistMetrics,
    MockFilingVelocityService
  }
})

vi.mock('../../../services/FilingVelocityService', () => ({
  FilingVelocityService: mocks.MockFilingVelocityService
}))

function makeDb(rows: Array<{ id: string }> = []) {
  return {
    query: vi.fn().mockResolvedValue(rows)
  }
}

describe('processVelocityAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes all prospects returned by query', async () => {
    const { processVelocityAnalysis } =
      await import('../../../queue/workers/velocityAnalysisWorker')
    const fakeMetrics = { filingCount: 3, velocityScore: 0.8 }
    mocks.mockComputeVelocity.mockResolvedValue(fakeMetrics)
    mocks.mockPersistMetrics.mockResolvedValue(undefined)

    const db = makeDb([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    const result = await processVelocityAnalysis(db)

    expect(result.processed).toBe(3)
    expect(result.errors).toBe(0)
  })

  it('calls computeVelocity and persistMetrics for each prospect', async () => {
    const { processVelocityAnalysis } =
      await import('../../../queue/workers/velocityAnalysisWorker')
    const fakeMetrics = { filingCount: 2, velocityScore: 0.5 }
    mocks.mockComputeVelocity.mockResolvedValue(fakeMetrics)
    mocks.mockPersistMetrics.mockResolvedValue(undefined)

    const db = makeDb([{ id: 'abc' }, { id: 'def' }])
    await processVelocityAnalysis(db)

    expect(mocks.mockComputeVelocity).toHaveBeenCalledTimes(2)
    expect(mocks.mockComputeVelocity).toHaveBeenCalledWith('abc')
    expect(mocks.mockComputeVelocity).toHaveBeenCalledWith('def')

    expect(mocks.mockPersistMetrics).toHaveBeenCalledTimes(2)
    expect(mocks.mockPersistMetrics).toHaveBeenCalledWith('abc', fakeMetrics)
    expect(mocks.mockPersistMetrics).toHaveBeenCalledWith('def', fakeMetrics)
  })

  it('reports correct processed count', async () => {
    const { processVelocityAnalysis } =
      await import('../../../queue/workers/velocityAnalysisWorker')
    mocks.mockComputeVelocity.mockResolvedValue({})
    mocks.mockPersistMetrics.mockResolvedValue(undefined)

    const db = makeDb([{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }, { id: 'x4' }])
    const result = await processVelocityAnalysis(db)

    expect(result.processed).toBe(4)
    expect(result.errors).toBe(0)
  })

  it('handles DB errors gracefully — increments error count and continues', async () => {
    const { processVelocityAnalysis } =
      await import('../../../queue/workers/velocityAnalysisWorker')
    mocks.mockComputeVelocity
      .mockResolvedValueOnce({ filingCount: 1 })
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce({ filingCount: 2 })
    mocks.mockPersistMetrics.mockResolvedValue(undefined)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const db = makeDb([{ id: 'ok1' }, { id: 'bad' }, { id: 'ok2' }])
    const result = await processVelocityAnalysis(db)

    expect(result.processed).toBe(2)
    expect(result.errors).toBe(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[velocity] Failed for prospect bad'),
      'DB timeout'
    )

    consoleSpy.mockRestore()
  })

  it('returns {processed: 0, errors: 0} when no prospects have filings', async () => {
    const { processVelocityAnalysis } =
      await import('../../../queue/workers/velocityAnalysisWorker')

    const db = makeDb([])
    const result = await processVelocityAnalysis(db)

    expect(result).toEqual({ processed: 0, errors: 0 })
    expect(mocks.mockComputeVelocity).not.toHaveBeenCalled()
    expect(mocks.mockPersistMetrics).not.toHaveBeenCalled()
  })
})
