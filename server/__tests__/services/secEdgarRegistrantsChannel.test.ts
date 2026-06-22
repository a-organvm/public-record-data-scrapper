import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Rate limiter is a no-op in tests — never block / hit a real bucket.
vi.mock('@public-records/core/enrichment', () => ({
  rateLimiterManager: {
    waitForTokens: vi.fn().mockResolvedValue(undefined)
  }
}))

import { SECEdgarRegistrantsChannel } from '../../services/discovery-channels/SECEdgarRegistrantsChannel'
import { DiscoveryChannelError } from '../../services/discovery-channels/types'

/** A successful JSON Response wrapping the documented EDGAR envelope. */
function edgarResponse(hits: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ hits: { hits } })
  } as unknown as Response
}

function hit(source: Record<string, unknown>): unknown {
  return { _source: source }
}

describe('SECEdgarRegistrantsChannel', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('always reports as configured (key-less public source)', () => {
    expect(new SECEdgarRegistrantsChannel().isConfigured()).toBe(true)
  })

  it('parses registrants, strips the CIK annotation, and scores S-1 above 8-K', async () => {
    fetchSpy.mockResolvedValueOnce(
      edgarResponse([
        hit({
          display_names: ['ACME, Inc.  (CIK 0001234567)'],
          biz_states: ['CA'],
          form: 'S-1',
          file_date: '2025-01-14',
          sics: ['7372'],
          ciks: ['0001234567']
        }),
        hit({
          display_names: ['Beta Co (CIK 0007654321)'],
          biz_states: ['NY'],
          form: '8-K',
          file_date: '2025-01-10',
          ciks: ['0007654321']
        })
      ])
    )

    const candidates = await new SECEdgarRegistrantsChannel().discover({ limit: 10 })

    expect(candidates.map((c) => c.company_name)).toEqual(['ACME, Inc.', 'Beta Co'])
    expect(candidates[0]).toMatchObject({
      state: 'CA',
      signal_type: 'expansion',
      signal_strength: 70, // S-1
      source: 'sec-edgar-registrants'
    })
    expect(candidates[0].raw).toMatchObject({ form: 'S-1', cik: '0001234567', sic: '7372' })
    expect(candidates[1].signal_strength).toBe(55) // 8-K
  })

  it('dedupes the same filer reported across multiple documents', async () => {
    fetchSpy.mockResolvedValueOnce(
      edgarResponse([
        hit({ display_names: ['Dup LLC (CIK 1)'], biz_states: ['CA'], form: 'S-1' }),
        hit({ display_names: ['Dup LLC (CIK 1)'], biz_states: ['CA'], form: '8-K' })
      ])
    )

    const candidates = await new SECEdgarRegistrantsChannel().discover({ limit: 10 })
    expect(candidates).toHaveLength(1)
  })

  it('filters to the requested state', async () => {
    fetchSpy.mockResolvedValueOnce(
      edgarResponse([
        hit({ display_names: ['CA Co (CIK 1)'], biz_states: ['CA'], form: 'S-1' }),
        hit({ display_names: ['NY Co (CIK 2)'], biz_states: ['NY'], form: 'S-1' })
      ])
    )

    const candidates = await new SECEdgarRegistrantsChannel().discover({ state: 'ca', limit: 10 })
    expect(candidates.map((c) => c.company_name)).toEqual(['CA Co'])
  })

  it('respects the limit', async () => {
    const hits = Array.from({ length: 5 }, (_, n) =>
      hit({ display_names: [`Co ${n} (CIK ${n})`], biz_states: ['CA'], form: 'S-1' })
    )
    fetchSpy.mockResolvedValueOnce(edgarResponse(hits))

    const candidates = await new SECEdgarRegistrantsChannel().discover({ limit: 2 })
    expect(candidates).toHaveLength(2)
  })

  it('fails closed when the upstream is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'))
    const err = await new SECEdgarRegistrantsChannel().discover({ limit: 10 }).catch((e) => e)
    expect(err).toBeInstanceOf(DiscoveryChannelError)
    expect((err as Error).message).toBe('SEC EDGAR unreachable: network down')
  })

  it('fails closed on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    } as unknown as Response)

    await expect(new SECEdgarRegistrantsChannel().discover({ limit: 10 })).rejects.toThrow(
      /SEC EDGAR returned HTTP 500 Internal Server Error/
    )
  })

  it('fails closed when the body is not valid JSON', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('Unexpected token')
      }
    } as unknown as Response)

    await expect(new SECEdgarRegistrantsChannel().discover({ limit: 10 })).rejects.toThrow(
      /SEC EDGAR response was not valid JSON: Unexpected token/
    )
  })

  it('fails closed when the documented envelope shape changed', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ unexpected: true })
    } as unknown as Response)

    await expect(new SECEdgarRegistrantsChannel().discover({ limit: 10 })).rejects.toThrow(
      /SEC EDGAR response shape changed/
    )
  })
})
