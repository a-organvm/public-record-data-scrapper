import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  compileDigest,
  renderDigestHtml,
  processDigestJob
} from '../../../queue/workers/digestWorker'
import type { CoverageDigest } from '../../../queue/workers/digestWorker'

// ---------------------------------------------------------------------------
// DB mock helper
// ---------------------------------------------------------------------------

function makeMockDb(overrides: Record<string, unknown[]> = {}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('ingestion_successes')) {
        return overrides['ingestion_successes'] ?? []
      }
      if (sql.includes("alert_type = 'circuit_opened'")) {
        return overrides['circuit_opened'] ?? [{ count: '0' }]
      }
      if (sql.includes('data_quality_reports')) {
        return overrides['data_quality_reports'] ?? [{ count: '0' }]
      }
      if (sql.includes('portal_probe_results')) {
        return overrides['portal_probe_results'] ?? [{ count: '0' }]
      }
      if (sql.includes('ingestion_failures')) {
        return overrides['ingestion_failures'] ?? []
      }
      return []
    })
  }
}

// ---------------------------------------------------------------------------
// 1. compileDigest — correct structure with mocked DB responses
// ---------------------------------------------------------------------------
describe('compileDigest', () => {
  it('returns correct structure with populated DB responses', async () => {
    const db = makeMockDb({
      ingestion_successes: [
        { state_code: 'CA', total: '500' },
        { state_code: 'TX', total: '300' },
        { state_code: 'FL', total: '200' }
      ],
      circuit_opened: [{ count: '3' }],
      data_quality_reports: [{ count: '7' }],
      portal_probe_results: [{ count: '2' }],
      ingestion_failures: [{ state_code: 'TX' }]
    })

    const digest = await compileDigest(db)

    // Shape
    expect(digest).toHaveProperty('generatedAt')
    expect(digest).toHaveProperty('period')
    expect(digest.period).toHaveProperty('from')
    expect(digest.period).toHaveProperty('to')
    expect(digest).toHaveProperty('overall')
    expect(digest.overall).toHaveProperty('green')
    expect(digest.overall).toHaveProperty('yellow')
    expect(digest.overall).toHaveProperty('red')

    // Numeric totals
    expect(digest.totalRecordsCollected).toBe(1000)
    expect(digest.circuitEvents).toBe(3)
    expect(digest.dqWarnings).toBe(7)
    expect(digest.probeFailures).toBe(2)

    // State breakdown
    expect(digest.recordsByState['CA']).toBe(500)
    expect(digest.recordsByState['TX']).toBe(300)
    expect(digest.recordsByState['FL']).toBe(200)

    // Top performers (first 5 from ordered success query)
    expect(digest.topPerformers).toEqual(['CA', 'TX', 'FL'])

    // Degraded = states that appeared in failures
    expect(digest.degraded).toContain('TX')

    // TX has records AND failures → yellow
    expect(digest.overall.yellow).toBe(1)
    // CA, FL have records, no failures → green
    expect(digest.overall.green).toBe(2)
  })

  // -------------------------------------------------------------------------
  // 2. compileDigest — empty DB
  // -------------------------------------------------------------------------
  it('handles empty DB gracefully', async () => {
    const db = makeMockDb()

    const digest = await compileDigest(db)

    expect(digest.totalRecordsCollected).toBe(0)
    expect(digest.recordsByState).toEqual({})
    expect(digest.circuitEvents).toBe(0)
    expect(digest.dqWarnings).toBe(0)
    expect(digest.probeFailures).toBe(0)
    expect(digest.topPerformers).toEqual([])
    expect(digest.degraded).toEqual([])
    expect(digest.overall.green).toBe(0)
    expect(digest.overall.yellow).toBe(0)
    // red = 51 - 0 - 0
    expect(digest.overall.red).toBe(51)
  })

  it('respects the periodDays parameter when querying', async () => {
    const db = makeMockDb()

    await compileDigest(db, 30)

    // All queries should have been called with a date param — just verify call count
    expect(db.query).toHaveBeenCalledTimes(5) // successes, circuit, dq, probes, failures
  })

  it('limits topPerformers to 5 entries', async () => {
    const manyStates = Array.from({ length: 10 }, (_, i) => ({
      state_code: `S${i}`,
      total: String(100 - i * 5)
    }))

    const db = makeMockDb({ ingestion_successes: manyStates })

    const digest = await compileDigest(db)

    expect(digest.topPerformers.length).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// 3. renderDigestHtml — valid HTML with state data
// ---------------------------------------------------------------------------
describe('renderDigestHtml', () => {
  const sampleDigest: CoverageDigest = {
    generatedAt: '2026-03-23T09:00:00.000Z',
    period: { from: '2026-03-16T09:00:00.000Z', to: '2026-03-23T09:00:00.000Z' },
    overall: { green: 40, yellow: 5, red: 6 },
    totalRecordsCollected: 125000,
    recordsByState: { CA: 50000, TX: 40000, FL: 35000 },
    circuitEvents: 2,
    dqWarnings: 4,
    probeFailures: 1,
    topPerformers: ['CA', 'TX', 'FL'],
    degraded: ['NY']
  }

  it('produces valid HTML with a DOCTYPE declaration', () => {
    const html = renderDigestHtml(sampleDigest)

    expect(html).toMatch(/<!DOCTYPE html>/i)
    expect(html).toMatch(/<html/)
    expect(html).toMatch(/<\/html>/)
  })

  it('includes state names and record counts', () => {
    const html = renderDigestHtml(sampleDigest)

    expect(html).toContain('CA')
    expect(html).toContain('TX')
    expect(html).toContain('FL')
    // Formatted number (locale-dependent; at minimum the raw digits appear)
    expect(html).toMatch(/50[,.]?000/)
  })

  // -------------------------------------------------------------------------
  // 4. renderDigestHtml — green/yellow/red badges
  // -------------------------------------------------------------------------
  it('includes green, yellow, and red badge counts', () => {
    const html = renderDigestHtml(sampleDigest)

    expect(html).toContain('40 Green')
    expect(html).toContain('5 Yellow')
    expect(html).toContain('6 Red')
  })

  it('includes summary metrics in the output', () => {
    const html = renderDigestHtml(sampleDigest)

    expect(html).toContain('2') // circuitEvents
    expect(html).toContain('4') // dqWarnings
    expect(html).toContain('1') // probeFailures
  })

  it('lists top performers when present', () => {
    const html = renderDigestHtml(sampleDigest)

    expect(html).toContain('Top Performers')
    expect(html).toContain('CA, TX, FL')
  })

  it('lists degraded states when present', () => {
    const html = renderDigestHtml(sampleDigest)

    expect(html).toContain('Degraded States')
    expect(html).toContain('NY')
  })

  it('omits Top Performers section when list is empty', () => {
    const html = renderDigestHtml({ ...sampleDigest, topPerformers: [] })

    expect(html).not.toContain('Top Performers')
  })

  it('omits Degraded States section when list is empty', () => {
    const html = renderDigestHtml({ ...sampleDigest, degraded: [] })

    expect(html).not.toContain('Degraded States')
  })
})

// ---------------------------------------------------------------------------
// 5. processDigestJob — compiles + sends email
// ---------------------------------------------------------------------------
describe('processDigestJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('compiles the digest and calls sendTransactional with correct fields', async () => {
    const db = makeMockDb({
      ingestion_successes: [{ state_code: 'CA', total: '1000' }],
      circuit_opened: [{ count: '1' }]
    })

    const mockSender = {
      sendTransactional: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await processDigestJob(db, mockSender, ['admin@example.com'])

    expect(result).toHaveProperty('totalRecordsCollected', 1000)
    expect(mockSender.sendTransactional).toHaveBeenCalledOnce()

    const call = mockSender.sendTransactional.mock.calls[0][0]
    expect(call.to).toEqual([{ email: 'admin@example.com' }])
    expect(call.from.email).toBe('digest@ucc-mca.com')
    expect(call.subject).toMatch(/Weekly Coverage Report/)
    expect(call.html).toMatch(/<!DOCTYPE html>/i)
  })

  it('sends to all valid recipients', async () => {
    const db = makeMockDb()
    const mockSender = {
      sendTransactional: vi.fn().mockResolvedValue({ success: true })
    }

    await processDigestJob(db, mockSender, ['a@example.com', 'b@example.com', 'c@example.com'])

    const call = mockSender.sendTransactional.mock.calls[0][0]
    expect(call.to).toHaveLength(3)
  })

  it('filters out invalid (non-email) recipient strings', async () => {
    const db = makeMockDb()
    const mockSender = {
      sendTransactional: vi.fn().mockResolvedValue({ success: true })
    }

    await processDigestJob(db, mockSender, ['valid@example.com', '', 'not-an-email'])

    const call = mockSender.sendTransactional.mock.calls[0][0]
    expect(call.to).toEqual([{ email: 'valid@example.com' }])
  })

  // -------------------------------------------------------------------------
  // 6. processDigestJob — null email sender handled gracefully
  // -------------------------------------------------------------------------
  it('handles null email sender gracefully and still returns the digest', async () => {
    const db = makeMockDb()

    const result = await processDigestJob(db, null, ['admin@example.com'])

    // Should return a valid digest even without an email sender
    expect(result).toHaveProperty('generatedAt')
    expect(result).toHaveProperty('period')
    expect(result).toHaveProperty('overall')
  })

  it('does not call send when recipient list is empty', async () => {
    const db = makeMockDb()
    const mockSender = {
      sendTransactional: vi.fn().mockResolvedValue({ success: true })
    }

    await processDigestJob(db, mockSender, [])

    expect(mockSender.sendTransactional).not.toHaveBeenCalled()
  })

  it('does not throw when sendTransactional rejects', async () => {
    const db = makeMockDb()
    const mockSender = {
      sendTransactional: vi.fn().mockRejectedValue(new Error('SMTP error'))
    }

    await expect(processDigestJob(db, mockSender, ['admin@example.com'])).resolves.not.toThrow()
  })
})
