import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OutreachSequenceService } from '../../services/OutreachSequenceService'
import { MINIMUM_CAPACITY_SCORE, SEQUENCE_COOLDOWN_DAYS } from '../../config/outreachTemplates'

describe('OutreachSequenceService', () => {
  let mockDb: { query: ReturnType<typeof vi.fn> }
  let service: OutreachSequenceService

  beforeEach(() => {
    mockDb = { query: vi.fn() }
    service = new OutreachSequenceService(mockDb)
  })

  describe('isEligible', () => {
    it('returns false when capacity score is below threshold', async () => {
      const result = await service.isEligible(
        'prospect-1',
        'termination',
        MINIMUM_CAPACITY_SCORE - 1
      )

      expect(result.eligible).toBe(false)
      expect(result.reason).toContain(`below threshold ${MINIMUM_CAPACITY_SCORE}`)
      // DB should not be queried — fail fast on score
      expect(mockDb.query).not.toHaveBeenCalled()
    })

    it('returns false when recent sequence exists (cooldown)', async () => {
      // Score passes, but a recent sequence row is found
      mockDb.query.mockResolvedValueOnce([{ id: 'seq-existing' }])

      const result = await service.isEligible('prospect-1', 'termination', MINIMUM_CAPACITY_SCORE)

      expect(result.eligible).toBe(false)
      expect(result.reason).toContain(`cooldown ${SEQUENCE_COOLDOWN_DAYS} days`)
    })

    it('returns false when no templates are configured for trigger type', async () => {
      // No recent sequence rows
      mockDb.query.mockResolvedValueOnce([])

      const result = await service.isEligible('prospect-1', 'unknown_trigger_type')

      expect(result.eligible).toBe(false)
      expect(result.reason).toContain(
        'No templates configured for trigger type: unknown_trigger_type'
      )
    })

    it('returns true when all checks pass', async () => {
      // No recent sequence rows
      mockDb.query.mockResolvedValueOnce([])

      const result = await service.isEligible('prospect-1', 'termination', MINIMUM_CAPACITY_SCORE)

      expect(result.eligible).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('returns true when capacity score is omitted (no score check)', async () => {
      mockDb.query.mockResolvedValueOnce([])

      const result = await service.isEligible('prospect-1', 'termination')

      expect(result.eligible).toBe(true)
    })
  })

  describe('createSequence', () => {
    it('creates sequence row and step rows for each template', async () => {
      const sequenceId = 'seq-new-1'

      // First call: INSERT outreach_sequences RETURNING id
      mockDb.query.mockResolvedValueOnce([{ id: sequenceId }])
      // Subsequent calls: INSERT outreach_steps (one per template step) + UPDATE started_at
      mockDb.query.mockResolvedValue([])

      const result = await service.createSequence('prospect-1', 'termination', 'filing-ev-1', 75)

      expect(result).toBe(sequenceId)

      // First call creates the sequence
      const firstCall = mockDb.query.mock.calls[0]
      expect(firstCall[0]).toMatch(/INSERT INTO outreach_sequences/)
      expect(firstCall[1]).toContain('prospect-1')
      expect(firstCall[1]).toContain('filing-ev-1')
      expect(firstCall[1]).toContain('termination')

      // 'termination' has 2 templates → 2 step inserts
      const stepInsertCalls = mockDb.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('INSERT INTO outreach_steps')
      )
      expect(stepInsertCalls).toHaveLength(2)

      // First step should be step_number=1
      expect(stepInsertCalls[0][1][1]).toBe(1)
      // Second step should be step_number=2
      expect(stepInsertCalls[1][1][1]).toBe(2)

      // Last call updates started_at
      const lastCall = mockDb.query.mock.calls[mockDb.query.mock.calls.length - 1]
      expect(lastCall[0]).toMatch(/UPDATE outreach_sequences SET started_at/)
      expect(lastCall[1]).toContain(sequenceId)
    })

    it('creates sequence with null filing_event_id when not provided', async () => {
      mockDb.query.mockResolvedValueOnce([{ id: 'seq-2' }])
      mockDb.query.mockResolvedValue([])

      await service.createSequence('prospect-2', 'new_filing')

      const firstCall = mockDb.query.mock.calls[0]
      // filingEventId should be null (index 1 in params after prospectId)
      expect(firstCall[1][1]).toBeNull()
    })

    it('sets step status to pending when delayMinutes is 0', async () => {
      mockDb.query.mockResolvedValueOnce([{ id: 'seq-3' }])
      mockDb.query.mockResolvedValue([])

      await service.createSequence('prospect-3', 'new_filing')

      const stepInsertCalls = mockDb.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('INSERT INTO outreach_steps')
      )
      // new_filing has 1 template with delayMinutes=0 → status='pending', scheduledFor=null
      expect(stepInsertCalls[0][1][6]).toBeNull() // scheduled_for
      expect(stepInsertCalls[0][1][7]).toBe('pending') // status
    })

    it('sets step status to scheduled when delayMinutes > 0', async () => {
      mockDb.query.mockResolvedValueOnce([{ id: 'seq-4' }])
      mockDb.query.mockResolvedValue([])

      // 'termination' has step 2 with delayMinutes=2880
      await service.createSequence('prospect-4', 'termination')

      const stepInsertCalls = mockDb.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('INSERT INTO outreach_steps')
      )
      // Second step (index 1) has delay
      expect(stepInsertCalls[1][1][6]).not.toBeNull() // scheduled_for is set
      expect(stepInsertCalls[1][1][7]).toBe('scheduled') // status
    })
  })

  describe('getNextPendingStep', () => {
    it('returns first pending step mapped to camelCase fields', async () => {
      mockDb.query.mockResolvedValueOnce([
        {
          id: 'step-1',
          step_number: 1,
          channel: 'email',
          template_key: 'termination-email-1',
          subject: 'Test Subject',
          body: 'Test body',
          scheduled_for: null
        }
      ])

      const step = await service.getNextPendingStep('seq-1')

      expect(step).not.toBeNull()
      expect(step!.id).toBe('step-1')
      expect(step!.stepNumber).toBe(1)
      expect(step!.channel).toBe('email')
      expect(step!.templateKey).toBe('termination-email-1')
      expect(step!.subject).toBe('Test Subject')
      expect(step!.scheduledFor).toBeNull()
    })

    it('returns null when no pending steps exist', async () => {
      mockDb.query.mockResolvedValueOnce([])

      const step = await service.getNextPendingStep('seq-empty')

      expect(step).toBeNull()
    })
  })

  describe('updateStepStatus', () => {
    it('updates step with sent status and external ID', async () => {
      mockDb.query.mockResolvedValueOnce([])

      await service.updateStepStatus('step-1', 'sent', 'ext-msg-123')

      expect(mockDb.query).toHaveBeenCalledTimes(1)
      const [sql, params] = mockDb.query.mock.calls[0]
      expect(sql).toMatch(/UPDATE outreach_steps/)
      expect(params[0]).toBe('step-1')
      expect(params[1]).toBe('sent')
      expect(params[2]).toBe('ext-msg-123')
    })

    it('updates step with error message', async () => {
      mockDb.query.mockResolvedValueOnce([])

      await service.updateStepStatus('step-2', 'failed', undefined, 'Delivery failed')

      const [, params] = mockDb.query.mock.calls[0]
      expect(params[1]).toBe('failed')
      expect(params[2]).toBeNull()
      expect(params[3]).toBe('Delivery failed')
    })
  })

  describe('completeSequence', () => {
    it('marks sequence as completed', async () => {
      mockDb.query.mockResolvedValueOnce([])

      await service.completeSequence('seq-done')

      expect(mockDb.query).toHaveBeenCalledTimes(1)
      const [sql, params] = mockDb.query.mock.calls[0]
      expect(sql).toMatch(/UPDATE outreach_sequences/)
      expect(sql).toMatch(/status = 'completed'/)
      expect(sql).toMatch(/completed_at = NOW\(\)/)
      expect(params[0]).toBe('seq-done')
    })
  })

  describe('cancelSequence', () => {
    it('cancels sequence and skips pending steps', async () => {
      mockDb.query.mockResolvedValue([])

      await service.cancelSequence('seq-cancel')

      expect(mockDb.query).toHaveBeenCalledTimes(2)

      const [seqSql, seqParams] = mockDb.query.mock.calls[0]
      expect(seqSql).toMatch(/UPDATE outreach_sequences SET status = 'cancelled'/)
      expect(seqParams[0]).toBe('seq-cancel')

      const [stepSql, stepParams] = mockDb.query.mock.calls[1]
      expect(stepSql).toMatch(/UPDATE outreach_steps SET status = 'skipped'/)
      expect(stepSql).toMatch(/status IN \('pending', 'scheduled'\)/)
      expect(stepParams[0]).toBe('seq-cancel')
    })
  })
})
