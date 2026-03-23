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

import { processOutreachJob } from '../../../queue/workers/outreachWorker'
import type { OutreachJobData } from '../../../queue/workers/outreachWorker'

function makeDb(scheduledCount = '0') {
  return {
    query: vi.fn().mockResolvedValue([{ count: scheduledCount }])
  }
}

const baseJobData: OutreachJobData = {
  prospectId: 'prospect-123',
  triggerType: 'termination',
  triggeredBy: 'event'
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
    const db = makeDb()

    const result = await processOutreachJob(baseJobData, db)

    expect(result.skipped).toBe(true)
    expect(result.sequenceId).toBeNull()
    expect(result.stepsSent).toBe(0)
    expect(result.reason).toBe('Active or recent sequence exists (cooldown 30 days)')
    expect(mocks.mockCreateSequence).not.toHaveBeenCalled()
  })

  it('creates a sequence and processes immediate pending steps', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-abc')
    // Return one step, then null to end the loop, then null for the remaining check
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({ id: 'step-1', stepNumber: 1, channel: 'email' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)
    const db = makeDb('0')

    const result = await processOutreachJob(baseJobData, db)

    expect(result.skipped).toBe(false)
    expect(result.sequenceId).toBe('seq-abc')
    expect(result.stepsSent).toBe(1)
    expect(mocks.mockCreateSequence).toHaveBeenCalledWith(
      'prospect-123',
      'termination',
      undefined,
      undefined
    )
  })

  it('marks steps as sent with correct external IDs', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-xyz')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({ id: 'step-1', stepNumber: 1, channel: 'email' })
      .mockResolvedValueOnce({ id: 'step-2', stepNumber: 2, channel: 'sms' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)
    const db = makeDb('0')

    const result = await processOutreachJob(baseJobData, db)

    expect(result.stepsSent).toBe(2)
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith(
      'step-1',
      'sent',
      'outreach-seq-xyz-step-1'
    )
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith(
      'step-2',
      'sent',
      'outreach-seq-xyz-step-2'
    )
  })

  it('handles step failure gracefully and continues to next step', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-fail')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({ id: 'step-1', stepNumber: 1, channel: 'email' })
      .mockResolvedValueOnce({ id: 'step-2', stepNumber: 2, channel: 'sms' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    // First call fails, second succeeds
    mocks.mockUpdateStepStatus
      .mockRejectedValueOnce(new Error('Send error'))
      .mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)
    const db = makeDb('0')

    const result = await processOutreachJob(baseJobData, db)

    // step-1 failed (and got marked failed via catch), step-2 sent
    expect(result.stepsSent).toBe(1)
    expect(result.skipped).toBe(false)
    // The catch block calls updateStepStatus with 'failed'
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith(
      'step-1',
      'failed',
      undefined,
      'Send error'
    )
    expect(mocks.mockUpdateStepStatus).toHaveBeenCalledWith(
      'step-2',
      'sent',
      'outreach-seq-fail-step-2'
    )
  })

  it('completes the sequence when all steps are done and none are scheduled', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-complete')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({ id: 'step-1', stepNumber: 1, channel: 'email' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)
    const db = makeDb('0')

    await processOutreachJob(baseJobData, db)

    expect(mocks.mockCompleteSequence).toHaveBeenCalledWith('seq-complete')
  })

  it('does not complete sequence when scheduled steps remain', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-partial')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({ id: 'step-1', stepNumber: 1, channel: 'email' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    const db = makeDb('2') // 2 scheduled steps remaining

    await processOutreachJob(baseJobData, db)

    expect(mocks.mockCompleteSequence).not.toHaveBeenCalled()
  })

  it('reports correct stepsSent count across multiple steps', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-multi')
    mocks.mockGetNextPendingStep
      .mockResolvedValueOnce({ id: 'step-1', stepNumber: 1, channel: 'email' })
      .mockResolvedValueOnce({ id: 'step-2', stepNumber: 2, channel: 'email' })
      .mockResolvedValueOnce({ id: 'step-3', stepNumber: 3, channel: 'sms' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mocks.mockUpdateStepStatus.mockResolvedValue(undefined)
    mocks.mockCompleteSequence.mockResolvedValue(undefined)
    const db = makeDb('0')

    const result = await processOutreachJob(baseJobData, db)

    expect(result.stepsSent).toBe(3)
  })

  it('passes capacityScore and filingEventId to createSequence', async () => {
    mocks.mockIsEligible.mockResolvedValue({ eligible: true })
    mocks.mockCreateSequence.mockResolvedValue('seq-cap')
    mocks.mockGetNextPendingStep.mockResolvedValue(null)
    const db = makeDb('0')

    const jobData: OutreachJobData = {
      ...baseJobData,
      filingEventId: 'filing-event-456',
      capacityScore: 75
    }

    await processOutreachJob(jobData, db)

    expect(mocks.mockCreateSequence).toHaveBeenCalledWith(
      'prospect-123',
      'termination',
      'filing-event-456',
      75
    )
    expect(mocks.mockIsEligible).toHaveBeenCalledWith('prospect-123', 'termination', 75)
  })
})
