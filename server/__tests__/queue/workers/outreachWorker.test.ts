import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockIsEligible = vi.fn()
  const mockCreateSequence = vi.fn()
  const mockGetNextPendingStep = vi.fn()
  const mockUpdateStepStatus = vi.fn()
  const mockCompleteSequence = vi.fn()
  const mockGetActiveSequences = vi.fn()
  const mockCancelSequence = vi.fn()

  class MockOutreachSequenceService {
    isEligible = mockIsEligible
    createSequence = mockCreateSequence
    getNextPendingStep = mockGetNextPendingStep
    updateStepStatus = mockUpdateStepStatus
    completeSequence = mockCompleteSequence
    getActiveSequences = mockGetActiveSequences
    cancelSequence = mockCancelSequence
  }

  return {
    MockOutreachSequenceService,
    mockIsEligible,
    mockCreateSequence,
    mockGetNextPendingStep,
    mockUpdateStepStatus,
    mockCompleteSequence,
    mockGetActiveSequences,
    mockCancelSequence
  }
})

vi.mock('../../../services/OutreachSequenceService', () => ({
  OutreachSequenceService: mocks.MockOutreachSequenceService
}))

// CommunicationsService is imported by the worker module but never constructed
// in these tests (a mock sender is always injected). Stub it so importing the
// worker does not pull in the integration clients / live database singleton.
vi.mock('../../../services/CommunicationsService', () => ({
  CommunicationsService: class {
    sendEmail = vi.fn()
    sendSMS = vi.fn()
  }
}))

import { processOutreachJob } from '../../../queue/workers/outreachWorker'
import type { OutreachJobData, OutreachSender } from '../../../queue/workers/outreachWorker'

// A db mock that answers the prospect/contact resolution queries and the
// scheduled-step count. The first query (prospects) returns org_id, the second
// (contacts) returns a primary contact, and any COUNT query returns the
// scheduled-step count.
function makeDb(opts: {
  orgId?: string | null
  contact?: { id: string; email: string | null; phone: string | null; mobile: string | null } | null
  scheduledCount?: string
}) {
  const {
    orgId = 'org-1',
    contact = { id: 'c-1', email: 'owner@acme.test', phone: '5551234567', mobile: null },
    scheduledCount = '0'
  } = opts
  const query = vi.fn((sql: string) => {
    if (sql.includes('FROM prospects')) {
      return Promise.resolve(orgId ? [{ org_id: orgId }] : [])
    }
    if (sql.includes('FROM contacts')) {
      return Promise.resolve(contact ? [contact] : [])
    }
    if (sql.includes('COUNT(*)')) {
      return Promise.resolve([{ count: scheduledCount }])
    }
    return Promise.resolve([])
  })
  return { query }
}

const baseJobData: OutreachJobData = {
  prospectId: 'prospect-123',
  triggerType: 'termination',
  triggeredBy: 'event'
}

function makeSender(overrides?: Partial<OutreachSender>): OutreachSender {
  return {
    sendEmail: vi.fn().mockResolvedValue({ status: 'sent', externalId: 'sg-1' }),
    sendSMS: vi.fn().mockResolvedValue({ status: 'sent', externalId: 'tw-1' }),
    ...overrides
  }
}

describe('processOutreachJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips when prospect is not eligible', async () => {
    mocks.mockIsEligible.mockResolvedValue({
      eligible: false,
      reason: 'Active or recent sequence exists (cooldown 30 days)'
    })

    const result = await processOutreachJob(baseJobData, makeDb({}), makeSender())

    expect(result.skipped).toBe(true)
    expect(result.sequenceId).toBeNull()
    expect(result.stepsSent).toBe(0)
    expect(result.reason).toBe('Active or recent sequence exists (cooldown 30 days)')
    expect(mocks.mockCreateSequence).not.toHaveBeenCalled()
  })

  it('marks an email step SENT when CommunicationsService reports success', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-ok')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'Hello there'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)

    const sender = makeSender()
    const result = await processOutreachJob(baseJobData, makeDb({}), sender)

    expect(result.stepsSent).toBe(1)
    expect(result.stepsFailed).toBe(0)
    expect(sender.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        prospectId: 'prospect-123',
        contactId: 'c-1',
        toAddress: 'owner@acme.test',
        subject: 'Hi',
        body: 'Hello there'
      })
    )
    // Only marked 'sent' on real success, carrying the provider external id.
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith('step-1', 'sent', 'sg-1')
  })

  it('marks an SMS step SENT on success with the provider SID', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-sms')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'sms',
        subject: null,
        body: 'Quick call?'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)

    const sender = makeSender()
    const result = await processOutreachJob(baseJobData, makeDb({}), sender)

    expect(result.stepsSent).toBe(1)
    expect(sender.sendSMS).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', toPhone: '5551234567', body: 'Quick call?' })
    )
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith('step-1', 'sent', 'tw-1')
  })

  it('fails CLOSED (failed, not sent) when the email provider is unconfigured (non-sent status)', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-unconfigured')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'Hello'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)

    // Unconfigured SendGrid path: CommunicationsService returns a non-'sent'
    // status rather than throwing.
    const sender = makeSender({
      sendEmail: vi.fn().mockResolvedValue({ status: 'failed' })
    })

    const result = await processOutreachJob(baseJobData, makeDb({}), sender)

    expect(result.stepsSent).toBe(0)
    expect(result.stepsFailed).toBe(1)
    // Must be marked 'failed' with a reason — never 'sent'.
    const call = mocks.mockUpdateStepStatus.mock.calls.find((c) => c[0] === 'step-1')
    expect(call?.[1]).toBe('failed')
    expect(call?.[3]).toMatch(/not sent|unconfigured/i)
    // Assert it was NEVER marked sent.
    expect(mocks.mockUpdateStepStatus).not.toHaveBeenCalledWith('step-1', 'sent', expect.anything())
  })

  it('fails CLOSED when the provider THROWS (e.g. Twilio unconfigured)', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-throw')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'sms',
        subject: null,
        body: 'Hello'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)

    const sender = makeSender({
      sendSMS: vi.fn().mockRejectedValue(new Error('Twilio: Failed to send SMS'))
    })

    const result = await processOutreachJob(baseJobData, makeDb({}), sender)

    expect(result.stepsSent).toBe(0)
    expect(result.stepsFailed).toBe(1)
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith(
      'step-1',
      'failed',
      undefined,
      'Twilio: Failed to send SMS'
    )
    expect(mocks.mockUpdateStepStatus).not.toHaveBeenCalledWith('step-1', 'sent', expect.anything())
  })

  it('fails CLOSED when no contact email is on file for an email step', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-nocontact')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'Hello'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)

    const sender = makeSender()
    const db = makeDb({ contact: { id: 'c-1', email: null, phone: null, mobile: null } })

    const result = await processOutreachJob(baseJobData, db, sender)

    expect(result.stepsSent).toBe(0)
    expect(result.stepsFailed).toBe(1)
    expect(sender.sendEmail).not.toHaveBeenCalled()
    const call = mocks.mockUpdateStepStatus.mock.calls.find((c) => c[0] === 'step-1')
    expect(call?.[1]).toBe('failed')
    expect(call?.[3]).toMatch(/no contact email/i)
  })

  it('fails CLOSED for every step when the prospect has no org resolved', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-noorg')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'Hello'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)

    const sender = makeSender()
    const db = makeDb({ orgId: null })

    const result = await processOutreachJob(baseJobData, db, sender)

    expect(result.stepsFailed).toBe(1)
    expect(sender.sendEmail).not.toHaveBeenCalled()
    const call = mocks.mockUpdateStepStatus.mock.calls.find((c) => c[0] === 'step-1')
    expect(call?.[1]).toBe('failed')
    expect(call?.[3]).toMatch(/no org/i)
  })

  it('mixes sent and failed across steps and reports both counts', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-mixed')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'A'
      })
      .mockResolvedValueOnce({
        id: 'step-2',
        stepNumber: 2,
        channel: 'sms',
        subject: null,
        body: 'B'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)

    const sender = makeSender({
      sendEmail: vi.fn().mockResolvedValue({ status: 'sent', externalId: 'sg-9' }),
      sendSMS: vi.fn().mockResolvedValue({ status: 'failed' })
    })

    const result = await processOutreachJob(baseJobData, makeDb({}), sender)

    expect(result.stepsSent).toBe(1)
    expect(result.stepsFailed).toBe(1)
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith('step-1', 'sent', 'sg-9')
    const failCall = mocks.mockUpdateStepStatus.mock.calls.find((c) => c[0] === 'step-2')
    expect(failCall?.[1]).toBe('failed')
  })

  it('completes the sequence when all steps done and none scheduled', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-complete')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'A'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)

    await processOutreachJob(baseJobData, makeDb({ scheduledCount: '0' }), makeSender())

    expect(mocks.mockCompleteSequence).toHaveBeenCalledWith('seq-complete')
  })

  it('does not complete the sequence when scheduled steps remain', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-partial')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({
        id: 'step-1',
        stepNumber: 1,
        channel: 'email',
        subject: 'Hi',
        body: 'A'
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)

    await processOutreachJob(baseJobData, makeDb({ scheduledCount: '2' }), makeSender())

    expect(mocks.mockCompleteSequence).not.toHaveBeenCalled()
  })

  it('passes capacityScore and filingEventId to createSequence', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-cap')
    mocks.mockGetNextPendingStep.mockResolvedValue(null)

    const jobData: OutreachJobData = {
      ...baseJobData,
      filingEventId: 'filing-event-456',
      capacityScore: 75
    }

    await processOutreachJob(jobData, makeDb({}), makeSender())

    expect(mocks.mockCreateSequence).toHaveBeenCalledWith(
      'prospect-123',
      'termination',
      'filing-event-456',
      75
    )
    expect(mocks.mockIsEligible).toHaveBeenCalledWith('prospect-123', 'termination', 75)
  })
})
