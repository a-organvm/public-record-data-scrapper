import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LeadExportService,
  serializeLeadExportCsv,
  type LeadExportBatch
} from '../../services/LeadExportService'
import { ValidationError } from '../../errors'

vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('LeadExportService', () => {
  let service: LeadExportService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new LeadExportService()
  })

  it('exports scored leads with filters and pagination metadata', async () => {
    mockQuery
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([
        {
          id: 'prospect-1',
          company_name: 'Acme Bistro',
          state: 'CA',
          industry: 'restaurant',
          status: 'new',
          priority_score: 82,
          default_date: '2026-01-15',
          time_since_default: 30,
          last_filing_date: '2026-02-01',
          estimated_revenue: '250000.00',
          narrative: 'Strong MCA potential.',
          enrichment_confidence: '0.81',
          filing_count: 2,
          active_ucc_count: 1,
          terminated_ucc_count: 1,
          lapsed_ucc_count: 0,
          latest_ucc_filing_date: '2026-02-01',
          secured_parties: ['Rapid Funding LLC', 'First Capital MCA']
        },
        {
          id: 'prospect-2',
          company_name: 'Peak Retail',
          state: 'CA',
          industry: 'retail',
          status: 'contacted',
          priority_score: 76,
          default_date: '2025-12-10',
          time_since_default: 66,
          last_filing_date: null,
          estimated_revenue: null,
          narrative: null,
          enrichment_confidence: null,
          filing_count: 1,
          active_ucc_count: 0,
          terminated_ucc_count: 1,
          lapsed_ucc_count: 0,
          latest_ucc_filing_date: '2026-01-05',
          secured_parties: ['Merchant Growth Partners']
        }
      ])

    const batch = await service.exportLeads({
      state: 'CA',
      minScore: 75,
      limit: 2,
      offset: 0
    })

    expect(batch.batch.count).toBe(2)
    expect(batch.batch.total).toBe(3)
    expect(batch.batch.next_offset).toBe(2)
    expect(batch.batch.filters).toEqual({
      state: 'CA',
      industry: undefined,
      status: undefined,
      min_score: 75,
      max_score: undefined
    })
    expect(batch.leads[0]).toEqual(
      expect.objectContaining({
        prospect_id: 'prospect-1',
        company_name: 'Acme Bistro',
        mca_score: 82,
        score_grade: 'A',
        recommendation: 'high_priority',
        score_confidence: 81,
        estimated_revenue: 250000,
        ucc_filing_count: 2
      })
    )
    expect(batch.leads[1]).toEqual(
      expect.objectContaining({
        score_grade: 'B',
        recommendation: 'high_priority',
        score_confidence: 85
      })
    )

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('p.priority_score >= $1'),
      [75, 'CA']
    )
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('LIMIT $3 OFFSET $4'),
      [75, 'CA', 2, 0]
    )
  })

  it('validates score ranges before querying', async () => {
    await expect(service.exportLeads({ minScore: 80, maxScore: 60 })).rejects.toThrow(
      ValidationError
    )
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('serializes CSV with stable headers and escaped fields', () => {
    const batch: LeadExportBatch = {
      batch: {
        id: 'lead-export-test',
        generated_at: '2026-06-19T00:00:00.000Z',
        filters: { min_score: 70 },
        limit: 100,
        offset: 0,
        count: 1,
        total: 1,
        next_offset: null
      },
      leads: [
        {
          prospect_id: 'prospect-1',
          company_name: 'Acme, Inc.',
          state: 'NY',
          industry: 'restaurant',
          status: 'new',
          mca_score: 91,
          score_grade: 'A',
          recommendation: 'high_priority',
          score_confidence: 90,
          estimated_revenue: 500000,
          default_date: '2026-01-01',
          days_since_default: 42,
          last_filing_date: '2026-02-01',
          ucc_filing_count: 2,
          active_ucc_count: 1,
          terminated_ucc_count: 1,
          lapsed_ucc_count: 0,
          secured_parties: ['A Capital', 'B Funding'],
          narrative: 'Owner said "ready" for renewal.'
        }
      ]
    }

    const csv = serializeLeadExportCsv(batch)

    expect(csv.split('\n')[0]).toBe(
      'prospect_id,company_name,state,industry,status,mca_score,score_grade,recommendation,score_confidence,estimated_revenue,default_date,days_since_default,last_filing_date,ucc_filing_count,active_ucc_count,terminated_ucc_count,lapsed_ucc_count,secured_parties,narrative'
    )
    expect(csv).toContain('"Acme, Inc."')
    expect(csv).toContain('A Capital; B Funding')
    expect(csv).toContain('"Owner said ""ready"" for renewal."')
  })
})
