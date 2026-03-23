import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  probeState,
  persistProbeResult,
  processProbeJob,
  PROBE_ENDPOINTS,
  CAPTCHA_MARKERS,
  type PortalProbeResult
} from '../../../queue/workers/portalProbeWorker'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

// ---------------------------------------------------------------------------
// 1. probeState('CA') — successful HEAD
// ---------------------------------------------------------------------------
describe('probeState', () => {
  it('returns reachable=true with httpStatus=200 for successful HEAD (CA)', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const result = await probeState('CA')

    expect(result.stateCode).toBe('CA')
    expect(result.reachable).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(result.error).toBeNull()
    expect(result.schemaValid).toBe(true)
    expect(result.antiBot).toBe(false)
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)

    // Verify fetch was called with the CA URL and HEAD method
    expect(mockFetch).toHaveBeenCalledWith(
      PROBE_ENDPOINTS['CA'].url,
      expect.objectContaining({ method: 'HEAD' })
    )
  })

  // -------------------------------------------------------------------------
  // 2. probeState('CA') — network error
  // -------------------------------------------------------------------------
  it('returns reachable=false with error message on network failure (CA)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await probeState('CA')

    expect(result.reachable).toBe(false)
    expect(result.httpStatus).toBeNull()
    expect(result.error).toBe('ECONNREFUSED')
    expect(result.schemaValid).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 3. probeState('NY') — GET with expected markers present → schemaValid=true
  // -------------------------------------------------------------------------
  it('returns schemaValid=true when expected markers are present (NY)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>ucc_public web_search stuff</html>')
    })

    const result = await probeState('NY')

    expect(result.reachable).toBe(true)
    expect(result.schemaValid).toBe(true)
    expect(result.antiBot).toBe(false)
    expect(mockFetch).toHaveBeenCalledWith(
      PROBE_ENDPOINTS['NY'].url,
      expect.objectContaining({ method: 'GET' })
    )
  })

  // -------------------------------------------------------------------------
  // 4. probeState('NY') — GET with markers missing → schemaValid=false
  // -------------------------------------------------------------------------
  it('returns schemaValid=false when expected markers are missing (NY)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>some completely different page</html>')
    })

    const result = await probeState('NY')

    expect(result.reachable).toBe(true)
    expect(result.schemaValid).toBe(false)
    expect(result.antiBot).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 5. probeState('NY') — GET with CAPTCHA response → antiBot=true
  // -------------------------------------------------------------------------
  it('returns antiBot=true when CAPTCHA marker detected in response body (NY)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve('<html>ucc_public web_search Please complete the captcha challenge</html>')
    })

    const result = await probeState('NY')

    expect(result.reachable).toBe(true)
    expect(result.antiBot).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 6. probeState('XX') — unconfigured state
  // -------------------------------------------------------------------------
  it('returns reachable=false with descriptive error for unconfigured state', async () => {
    const result = await probeState('XX')

    expect(result.stateCode).toBe('XX')
    expect(result.reachable).toBe(false)
    expect(result.httpStatus).toBeNull()
    expect(result.error).toMatch(/No probe endpoint configured for XX/)
    expect(result.responseTimeMs).toBe(0)
    // fetch should NOT be called for an unconfigured state
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('normalises state code to uppercase', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const result = await probeState('ca')
    expect(result.stateCode).toBe('CA')
  })

  it('sets error message on non-ok HTTP response (HEAD)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 })

    const result = await probeState('CA')

    expect(result.reachable).toBe(false)
    expect(result.httpStatus).toBe(503)
    expect(result.error).toBe('HTTP 503')
  })
})

// ---------------------------------------------------------------------------
// 7. persistProbeResult — calls query with correct params
// ---------------------------------------------------------------------------
describe('persistProbeResult', () => {
  it('calls db.query with the correct SQL and parameter list', async () => {
    const mockQuery = vi.fn().mockResolvedValue([])
    const db = { query: mockQuery }

    const result: PortalProbeResult = {
      stateCode: 'CA',
      probeTimestamp: '2026-03-23T00:00:00.000Z',
      reachable: true,
      responseTimeMs: 42,
      httpStatus: 200,
      schemaValid: true,
      antiBot: false,
      error: null
    }

    await persistProbeResult(db, result)

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]

    expect(sql).toMatch(/INSERT INTO portal_probe_results/)
    expect(sql).toMatch(/state_code/)
    expect(params).toEqual(['CA', '2026-03-23T00:00:00.000Z', true, 42, 200, true, false, null])
  })
})

// ---------------------------------------------------------------------------
// 8. processProbeJob — probes all states and persists results
// ---------------------------------------------------------------------------
describe('processProbeJob', () => {
  it('probes all provided states and returns results for each', async () => {
    // CA (HEAD) and TX (HEAD) both succeed
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const mockQuery = vi.fn().mockResolvedValue([])
    const db = { query: mockQuery }
    const alertService = {
      handleAlert: vi.fn().mockResolvedValue({ logged: true, emailed: false })
    }

    const results = await processProbeJob(['CA', 'TX'], db, alertService)

    expect(results).toHaveLength(2)
    expect(results[0].stateCode).toBe('CA')
    expect(results[1].stateCode).toBe('TX')
    // One persist call per state
    expect(mockQuery).toHaveBeenCalledTimes(2)
    // No alerts for successful probes
    expect(alertService.handleAlert).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9. processProbeJob — triggers probe_failed alert on unreachable state
  // -------------------------------------------------------------------------
  it('triggers probe_failed alert when a state portal is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'))

    const mockQuery = vi.fn().mockResolvedValue([])
    const db = { query: mockQuery }
    const alertService = { handleAlert: vi.fn().mockResolvedValue({ logged: true, emailed: true }) }

    const results = await processProbeJob(['FL'], db, alertService)

    expect(results[0].reachable).toBe(false)
    expect(alertService.handleAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'probe_failed',
        stateCode: 'FL',
        error: expect.any(String)
      })
    )
  })

  // -------------------------------------------------------------------------
  // 10. processProbeJob — triggers schema_change alert on anti-bot detection
  // -------------------------------------------------------------------------
  it('triggers schema_change_detected alert when anti-bot is detected on reachable portal (NY)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>ucc_public web_search recaptcha challenge</html>')
    })

    const mockQuery = vi.fn().mockResolvedValue([])
    const db = { query: mockQuery }
    const alertService = { handleAlert: vi.fn().mockResolvedValue({ logged: true, emailed: true }) }

    const results = await processProbeJob(['NY'], db, alertService)

    expect(results[0].reachable).toBe(true)
    expect(results[0].antiBot).toBe(true)
    expect(alertService.handleAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'schema_change_detected',
        stateCode: 'NY'
      })
    )
  })

  it('triggers schema_change_detected alert when schema markers are missing on reachable portal (NY)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>completely different content here</html>')
    })

    const mockQuery = vi.fn().mockResolvedValue([])
    const db = { query: mockQuery }
    const alertService = {
      handleAlert: vi.fn().mockResolvedValue({ logged: true, emailed: false })
    }

    const results = await processProbeJob(['NY'], db, alertService)

    expect(results[0].reachable).toBe(true)
    expect(results[0].schemaValid).toBe(false)
    expect(alertService.handleAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'schema_change_detected',
        stateCode: 'NY'
      })
    )
  })

  it('does not throw when persistProbeResult fails — logs and continues', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const db = { query: vi.fn().mockRejectedValue(new Error('DB unavailable')) }
    const alertService = { handleAlert: vi.fn().mockResolvedValue({}) }

    // Should not throw even if persistence fails
    await expect(processProbeJob(['CA'], db, alertService)).resolves.toHaveLength(1)
  })

  it('does not throw when alertService.handleAlert fails — logs and continues', async () => {
    mockFetch.mockRejectedValue(new Error('Network down'))

    const db = { query: vi.fn().mockResolvedValue([]) }
    const alertService = { handleAlert: vi.fn().mockRejectedValue(new Error('Alert service down')) }

    // Should not throw even if alert fails
    await expect(processProbeJob(['CA'], db, alertService)).resolves.toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Exported constants sanity checks
// ---------------------------------------------------------------------------
describe('PROBE_ENDPOINTS and CAPTCHA_MARKERS exports', () => {
  it('exports PROBE_ENDPOINTS with entries for CA, TX, FL, NY', () => {
    expect(PROBE_ENDPOINTS).toHaveProperty('CA')
    expect(PROBE_ENDPOINTS).toHaveProperty('TX')
    expect(PROBE_ENDPOINTS).toHaveProperty('FL')
    expect(PROBE_ENDPOINTS).toHaveProperty('NY')
  })

  it('NY endpoint uses GET method with expectedMarkers', () => {
    expect(PROBE_ENDPOINTS['NY'].method).toBe('GET')
    expect(PROBE_ENDPOINTS['NY'].expectedMarkers).toContain('ucc_public')
    expect(PROBE_ENDPOINTS['NY'].expectedMarkers).toContain('web_search')
  })

  it('CA, TX, FL endpoints use HEAD method', () => {
    expect(PROBE_ENDPOINTS['CA'].method).toBe('HEAD')
    expect(PROBE_ENDPOINTS['TX'].method).toBe('HEAD')
    expect(PROBE_ENDPOINTS['FL'].method).toBe('HEAD')
  })

  it('exports CAPTCHA_MARKERS array with known captcha strings', () => {
    expect(CAPTCHA_MARKERS).toContain('captcha')
    expect(CAPTCHA_MARKERS).toContain('recaptcha')
    expect(CAPTCHA_MARKERS).toContain('hcaptcha')
  })
})
