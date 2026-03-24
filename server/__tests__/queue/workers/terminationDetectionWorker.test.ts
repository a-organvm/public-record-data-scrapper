import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  processTerminationDetection,
  type TerminationDetectionResult
} from '../../../queue/workers/terminationDetectionWorker'

describe('processTerminationDetection', () => {
  let mockDb: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockDb = { query: vi.fn() }
  })

  it('returns {detected: 0, eventsCreated: 0} when no terminated filings found', async () => {
    mockDb.query.mockResolvedValueOnce([]) // terminated query returns empty

    const result: TerminationDetectionResult = await processTerminationDetection(mockDb)

    expect(result).toEqual({ detected: 0, eventsCreated: 0 })
    expect(mockDb.query).toHaveBeenCalledTimes(1)
  })

  it('detects terminated filings and creates filing_events', async () => {
    const terminatedFiling = {
      id: 'filing-1',
      external_id: 'ext-1',
      filing_date: '2026-01-01',
      status: 'terminated',
      secured_party_name: 'Lender A',
      lien_amount: 50000,
      state: 'CA',
      termination_detected_at: '2026-03-20T10:00:00Z'
    }

    mockDb.query
      .mockResolvedValueOnce([terminatedFiling]) // terminated filings query
      .mockResolvedValueOnce([{ id: 'prospect-1' }]) // prospects lookup
      .mockResolvedValueOnce([]) // INSERT filing_events
      .mockResolvedValueOnce([]) // UPDATE prospects

    const result = await processTerminationDetection(mockDb)

    expect(result).toEqual({ detected: 1, eventsCreated: 1 })
  })

  it('links events to prospects via prospect_ucc_filings junction', async () => {
    const terminatedFiling = {
      id: 'filing-2',
      external_id: 'ext-2',
      filing_date: '2026-02-01',
      status: 'terminated',
      secured_party_name: 'Bank B',
      lien_amount: 25000,
      state: 'NY',
      termination_detected_at: '2026-03-21T09:00:00Z'
    }

    mockDb.query
      .mockResolvedValueOnce([terminatedFiling])
      .mockResolvedValueOnce([{ id: 'prospect-99' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await processTerminationDetection(mockDb)

    // The prospect lookup should query via prospect_ucc_filings with the filing id
    const prospectLookupCall = mockDb.query.mock.calls[1]
    expect(prospectLookupCall[0]).toMatch(/prospect_ucc_filings/)
    expect(prospectLookupCall[1]).toEqual(['filing-2'])

    // The INSERT should use the prospect id
    const insertCall = mockDb.query.mock.calls[2]
    expect(insertCall[0]).toMatch(/INSERT INTO filing_events/)
    expect(insertCall[1][0]).toBe('prospect-99')
    expect(insertCall[1][1]).toBe('filing-2')
  })

  it('skips filings with no linked prospect (eventsCreated < detected)', async () => {
    const filing1 = {
      id: 'filing-no-prospect',
      external_id: 'ext-np',
      filing_date: '2026-01-10',
      status: 'terminated',
      secured_party_name: 'Corp X',
      lien_amount: null,
      state: 'FL',
      termination_detected_at: '2026-03-15T00:00:00Z'
    }
    const filing2 = {
      id: 'filing-has-prospect',
      external_id: 'ext-hp',
      filing_date: '2026-01-15',
      status: 'terminated',
      secured_party_name: 'Corp Y',
      lien_amount: 10000,
      state: 'TX',
      termination_detected_at: '2026-03-16T00:00:00Z'
    }

    mockDb.query
      .mockResolvedValueOnce([filing1, filing2]) // terminated filings
      .mockResolvedValueOnce([]) // no prospect for filing1
      .mockResolvedValueOnce([{ id: 'prospect-2' }]) // prospect for filing2
      .mockResolvedValueOnce([]) // INSERT for filing2
      .mockResolvedValueOnce([]) // UPDATE for filing2

    const result = await processTerminationDetection(mockDb)

    expect(result.detected).toBe(2)
    expect(result.eventsCreated).toBe(1)
  })

  it('updates prospect updated_at for re-enrichment', async () => {
    const filing = {
      id: 'filing-3',
      external_id: 'ext-3',
      filing_date: '2026-03-01',
      status: 'terminated',
      secured_party_name: 'Fund C',
      lien_amount: 75000,
      state: 'WA',
      termination_detected_at: '2026-03-22T12:00:00Z'
    }

    mockDb.query
      .mockResolvedValueOnce([filing])
      .mockResolvedValueOnce([{ id: 'prospect-5' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await processTerminationDetection(mockDb)

    const updateCall = mockDb.query.mock.calls[3]
    expect(updateCall[0]).toMatch(/UPDATE prospects SET updated_at/)
    expect(updateCall[1]).toEqual(['prospect-5'])
  })

  it('handles empty results gracefully without throwing', async () => {
    mockDb.query.mockResolvedValueOnce([])

    await expect(processTerminationDetection(mockDb)).resolves.toEqual({
      detected: 0,
      eventsCreated: 0
    })
  })

  it('processes multiple terminated filings independently', async () => {
    const filings = [
      {
        id: 'f1',
        external_id: 'e1',
        filing_date: '2026-01-01',
        status: 'terminated',
        secured_party_name: 'A',
        lien_amount: 1000,
        state: 'CA',
        termination_detected_at: '2026-03-20T00:00:00Z'
      },
      {
        id: 'f2',
        external_id: 'e2',
        filing_date: '2026-01-02',
        status: 'terminated',
        secured_party_name: 'B',
        lien_amount: 2000,
        state: 'NY',
        termination_detected_at: '2026-03-21T00:00:00Z'
      }
    ]

    mockDb.query
      .mockResolvedValueOnce(filings)
      .mockResolvedValueOnce([{ id: 'p1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'p2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await processTerminationDetection(mockDb)

    expect(result).toEqual({ detected: 2, eventsCreated: 2 })
  })
})
