import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CoverageAlertService } from '../../services/CoverageAlertService'

describe('CoverageAlertService', () => {
  const mockQuery = vi.fn().mockResolvedValue([])
  const mockDb = { query: mockQuery }
  const mockSendTransactional = vi.fn().mockResolvedValue({ success: true })
  const mockEmailSender = { sendTransactional: mockSendTransactional }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ALERT_RECIPIENT_EMAIL = 'test@example.com'
  })

  afterEach(() => {
    delete process.env.ALERT_RECIPIENT_EMAIL
  })

  // 1. circuit_opened → logged=true, DB insert called
  it('logs a circuit_opened alert to the database', async () => {
    const service = new CoverageAlertService(mockDb)

    const result = await service.handleAlert({
      type: 'circuit_opened',
      stateCode: 'CA',
      reason: 'Too many failures'
    })

    expect(result.logged).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO coverage_alerts'),
      expect.arrayContaining(['circuit_opened', 'CA', 'high'])
    )
  })

  // 2. circuit_opened + email sender + ALERT_RECIPIENT_EMAIL → emailed=true
  it('emails the alert when sender and recipient are configured for circuit_opened', async () => {
    const service = new CoverageAlertService(mockDb, mockEmailSender)

    const result = await service.handleAlert({
      type: 'circuit_opened',
      stateCode: 'TX',
      reason: 'Timeout cascade'
    })

    expect(result.logged).toBe(true)
    expect(result.emailed).toBe(true)
    expect(mockSendTransactional).toHaveBeenCalledOnce()
    expect(mockSendTransactional).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [{ email: 'test@example.com' }],
        from: expect.objectContaining({ email: 'alerts@ucc-mca.com' }),
        subject: expect.stringContaining('circuit_opened')
      })
    )
  })

  // 3. Debounce: second call within 1 hour → logged=false
  it('debounces repeated alerts within the 1-hour cooldown window', async () => {
    const service = new CoverageAlertService(mockDb)

    const trigger = { type: 'circuit_opened' as const, stateCode: 'FL', reason: 'Overload' }

    const first = await service.handleAlert(trigger)
    expect(first.logged).toBe(true)

    const second = await service.handleAlert(trigger)
    expect(second.logged).toBe(false)
    expect(second.emailed).toBe(false)

    // DB insert called only once (for the first alert)
    const insertCalls = mockQuery.mock.calls.filter((args) =>
      String(args[0]).includes('INSERT INTO coverage_alerts')
    )
    expect(insertCalls).toHaveLength(1)
  })

  // 4. After clearCooldowns, same alert fires again
  it('fires again after clearCooldowns is called', async () => {
    const service = new CoverageAlertService(mockDb)

    const trigger = { type: 'probe_failed' as const, stateCode: 'NY', error: 'DNS timeout' }

    await service.handleAlert(trigger)
    service.clearCooldowns()

    const result = await service.handleAlert(trigger)
    expect(result.logged).toBe(true)

    const insertCalls = mockQuery.mock.calls.filter((args) =>
      String(args[0]).includes('INSERT INTO coverage_alerts')
    )
    expect(insertCalls).toHaveLength(2)
  })

  // 5. data_quality_failed → logged=true, emailed=false
  it('logs data_quality_failed but does not email it', async () => {
    const service = new CoverageAlertService(mockDb, mockEmailSender)

    const result = await service.handleAlert({
      type: 'data_quality_failed',
      stateCode: 'CA',
      warnings: ['Missing debtor name', 'Invalid filing date']
    })

    expect(result.logged).toBe(true)
    expect(result.emailed).toBe(false)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  // 6. state_status_changed to 'red' → emailed=true
  it('emails state_status_changed when transitioning to red', async () => {
    const service = new CoverageAlertService(mockDb, mockEmailSender)

    const result = await service.handleAlert({
      type: 'state_status_changed',
      stateCode: 'CA',
      from: 'yellow',
      to: 'red'
    })

    expect(result.logged).toBe(true)
    expect(result.emailed).toBe(true)
    expect(mockSendTransactional).toHaveBeenCalledOnce()
  })

  // 7. state_status_changed to 'yellow' → emailed=false
  it('does not email state_status_changed when transitioning to yellow', async () => {
    const service = new CoverageAlertService(mockDb, mockEmailSender)

    const result = await service.handleAlert({
      type: 'state_status_changed',
      stateCode: 'CA',
      from: 'green',
      to: 'yellow'
    })

    expect(result.logged).toBe(true)
    expect(result.emailed).toBe(false)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  // 8. getRecentAlerts queries with correct interval
  it('getRecentAlerts passes the correct hours interval to the query', async () => {
    const service = new CoverageAlertService(mockDb)

    await service.getRecentAlerts(48)

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('coverage_alerts'), ['48 hours'])
  })

  it('getRecentAlerts defaults to 24 hours', async () => {
    const service = new CoverageAlertService(mockDb)

    await service.getRecentAlerts()

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('coverage_alerts'), ['24 hours'])
  })

  // 9. Without email sender → emailed=false even for critical alerts
  it('does not email even critical alerts when no email sender is provided', async () => {
    const service = new CoverageAlertService(mockDb) // no emailSender

    const result = await service.handleAlert({
      type: 'schema_change_detected',
      stateCode: 'CA'
    })

    expect(result.logged).toBe(true)
    expect(result.emailed).toBe(false)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })

  it('does not email when ALERT_RECIPIENT_EMAIL is unset', async () => {
    delete process.env.ALERT_RECIPIENT_EMAIL
    const service = new CoverageAlertService(mockDb, mockEmailSender)

    const result = await service.handleAlert({
      type: 'circuit_opened',
      stateCode: 'CA',
      reason: 'Test'
    })

    expect(result.logged).toBe(true)
    expect(result.emailed).toBe(false)
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })
})
