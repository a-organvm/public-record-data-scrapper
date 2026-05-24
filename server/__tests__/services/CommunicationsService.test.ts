import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CommunicationsService } from '../../services/CommunicationsService'
import { ValidationError, DatabaseError, ForbiddenError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Mock Twilio integrations
vi.mock('../../integrations/twilio/client', () => ({
  TwilioClient: class MockTwilioClient {}
}))

vi.mock('../../integrations/twilio/sms', () => ({
  TwilioSMS: class MockTwilioSMS {
    send = vi.fn().mockResolvedValue({ messageSid: 'SM123' })
  }
}))

vi.mock('../../integrations/twilio/voice', () => ({
  TwilioVoice: class MockTwilioVoice {
    initiateCall = vi.fn().mockResolvedValue({ callSid: 'CA123' })
  }
}))

// Mock SendGrid integrations
vi.mock('../../integrations/sendgrid/client', () => ({
  SendGridClient: class MockSendGridClient {}
}))

vi.mock('../../integrations/sendgrid/send', () => ({
  SendGridSend: class MockSendGridSend {
    sendTransactional = vi.fn().mockResolvedValue({ messageId: 'msg-123' })
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('CommunicationsService', () => {
  let service: CommunicationsService

  // Permissive compliance stubs: these tests exercise transport/persistence
  // behavior, not the TCPA/DNC gate (which has dedicated tests below). Injecting
  // allow-all stubs keeps the existing per-test database.query mock sequences
  // valid (the gate would otherwise consume extra mock calls).
  const allowAllSuppression = {
    isOnDNCList: vi.fn().mockResolvedValue({ isSuppressed: false }),
    isEmailSuppressed: vi.fn().mockResolvedValue({ isSuppressed: false })
  }
  const allowAllConsent = {
    hasConsent: vi.fn().mockResolvedValue({ hasConsent: true })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    allowAllSuppression.isOnDNCList.mockResolvedValue({ isSuppressed: false })
    allowAllSuppression.isEmailSuppressed.mockResolvedValue({ isSuppressed: false })
    allowAllConsent.hasConsent.mockResolvedValue({ hasConsent: true })
    service = new CommunicationsService({
      suppressionService: allowAllSuppression as never,
      consentService: allowAllConsent as never
    })
  })

  describe('getTemplate', () => {
    it('should return template by id', async () => {
      const mockTemplate = {
        id: 'template-1',
        org_id: 'org-1',
        name: 'Welcome Email',
        channel: 'email',
        body: 'Hello {{name}}',
        variables: ['name'],
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockTemplate])

      const result = await service.getTemplate('template-1', 'org-1')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('template-1')
      expect(result?.name).toBe('Welcome Email')
    })

    it('should return null for non-existent template', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getTemplate('non-existent', 'org-1')

      expect(result).toBeNull()
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getTemplate('template-1', 'org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('renderTemplate', () => {
    it('should substitute variables in template', () => {
      const template = {
        id: 'template-1',
        orgId: 'org-1',
        name: 'Test',
        channel: 'email' as const,
        subject: 'Hello {{name}}',
        body: 'Dear {{name}}, your amount is {{amount}}',
        variables: ['name', 'amount'],
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }

      const result = service.renderTemplate(template, {
        name: 'John',
        amount: 50000
      })

      expect(result.subject).toBe('Hello John')
      expect(result.body).toBe('Dear John, your amount is 50000')
    })

    it('should leave unmatched variables as-is', () => {
      const template = {
        id: 'template-1',
        orgId: 'org-1',
        name: 'Test',
        channel: 'email' as const,
        body: 'Hello {{name}}, missing {{other}}',
        variables: ['name', 'other'],
        isActive: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }

      const result = service.renderTemplate(template, { name: 'John' })

      expect(result.body).toBe('Hello John, missing {{other}}')
    })
  })

  describe('listTemplates', () => {
    it('should return templates for organization', async () => {
      const mockTemplates = [
        {
          id: 'template-1',
          org_id: 'org-1',
          name: 'Template 1',
          channel: 'email',
          body: 'Body 1',
          variables: [],
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'template-2',
          org_id: 'org-1',
          name: 'Template 2',
          channel: 'sms',
          body: 'Body 2',
          variables: [],
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockTemplates)

      const result = await service.listTemplates('org-1')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Template 1')
    })

    it('should filter by channel', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.listTemplates('org-1', 'email')

      expect(mockQuery.mock.calls[0][0]).toContain('channel = $2')
      expect(mockQuery.mock.calls[0][1]).toContain('email')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.listTemplates('org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('sendEmail', () => {
    it('should send email and create communication record', async () => {
      const mockCommunication = {
        id: 'comm-1',
        org_id: 'org-1',
        channel: 'email',
        direction: 'outbound',
        to_address: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test body',
        status: 'queued',
        attachments: [],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockCommunication])

      const result = await service.sendEmail({
        orgId: 'org-1',
        toAddress: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test body'
      })

      expect(result.id).toBe('comm-1')
      expect(result.channel).toBe('email')
      expect(result.status).toBe('sent')
    })

    it('should throw ValidationError for invalid email', async () => {
      await expect(
        service.sendEmail({
          orgId: 'org-1',
          toAddress: 'invalid-email',
          subject: 'Test',
          body: 'Test'
        })
      ).rejects.toThrow(ValidationError)
    })

    it('should create pending status for scheduled emails', async () => {
      const mockCommunication = {
        id: 'comm-1',
        org_id: 'org-1',
        channel: 'email',
        direction: 'outbound',
        to_address: 'test@example.com',
        status: 'pending',
        scheduled_for: '2024-12-01T00:00:00Z',
        attachments: [],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockCommunication])

      const result = await service.sendEmail({
        orgId: 'org-1',
        toAddress: 'test@example.com',
        subject: 'Test',
        body: 'Test',
        scheduledFor: '2024-12-01T00:00:00Z'
      })

      expect(result.status).toBe('pending')
    })
  })

  describe('sendSMS', () => {
    it('should send SMS with normalized phone', async () => {
      const mockCommunication = {
        id: 'comm-1',
        org_id: 'org-1',
        channel: 'sms',
        direction: 'outbound',
        to_phone: '1234567890',
        body: 'Test message',
        status: 'queued',
        attachments: [],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockCommunication])

      const result = await service.sendSMS({
        orgId: 'org-1',
        toPhone: '(123) 456-7890',
        body: 'Test message'
      })

      expect(result.channel).toBe('sms')
      expect(result.status).toBe('sent')
    })

    it('should throw ValidationError for invalid phone', async () => {
      await expect(
        service.sendSMS({
          orgId: 'org-1',
          toPhone: '123',
          body: 'Test'
        })
      ).rejects.toThrow(ValidationError)
    })
  })

  describe('initiateCall', () => {
    it('should initiate call and create record', async () => {
      const mockCommunication = {
        id: 'comm-1',
        org_id: 'org-1',
        channel: 'call',
        direction: 'outbound',
        to_phone: '1234567890',
        status: 'pending',
        attachments: [],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockCommunication])

      const result = await service.initiateCall({
        orgId: 'org-1',
        toPhone: '1234567890'
      })

      expect(result.channel).toBe('call')
      expect(result.externalId).toBe('CA123')
    })

    it('should throw ValidationError for invalid phone', async () => {
      await expect(
        service.initiateCall({
          orgId: 'org-1',
          toPhone: '123'
        })
      ).rejects.toThrow(ValidationError)
    })
  })

  describe('send', () => {
    it('should route to sendEmail for email channel', async () => {
      const mockCommunication = {
        id: 'comm-1',
        org_id: 'org-1',
        channel: 'email',
        direction: 'outbound',
        to_address: 'test@example.com',
        status: 'queued',
        attachments: [],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockCommunication])

      const result = await service.send('email', {
        orgId: 'org-1',
        toAddress: 'test@example.com',
        subject: 'Test',
        body: 'Test'
      })

      expect(result.channel).toBe('email')
    })

    it('should throw ValidationError for unsupported channel', async () => {
      await expect(
        service.send(
          'fax' as unknown as 'email',
          { orgId: 'org-1' } as unknown as Parameters<typeof service.send>[1]
        )
      ).rejects.toThrow(ValidationError)
    })
  })

  describe('TCPA / DNC compliance gate', () => {
    it('should block an email send when the address is on the suppression list', async () => {
      allowAllSuppression.isEmailSuppressed.mockResolvedValueOnce({
        isSuppressed: true,
        source: 'internal'
      })
      // Audit-row insert for the blocked communication.
      mockQuery.mockResolvedValueOnce([])

      await expect(
        service.sendEmail({
          orgId: 'org-1',
          toAddress: 'blocked@example.com',
          subject: 'Test',
          body: 'Test'
        })
      ).rejects.toThrow(ForbiddenError)

      expect(allowAllSuppression.isEmailSuppressed).toHaveBeenCalled()
    })

    it('should block an SMS send when the number is on the DNC list', async () => {
      allowAllSuppression.isOnDNCList.mockResolvedValueOnce({
        isSuppressed: true,
        source: 'federal_dnc'
      })
      mockQuery.mockResolvedValueOnce([])

      await expect(
        service.sendSMS({
          orgId: 'org-1',
          toPhone: '(123) 456-7890',
          body: 'Test'
        })
      ).rejects.toThrow(ForbiddenError)
    })

    it('should block a send to a known contact without consent', async () => {
      allowAllConsent.hasConsent.mockResolvedValueOnce({ hasConsent: false })
      mockQuery.mockResolvedValueOnce([])

      await expect(
        service.sendSMS({
          orgId: 'org-1',
          contactId: 'contact-1',
          toPhone: '(123) 456-7890',
          body: 'Test'
        })
      ).rejects.toThrow(ForbiddenError)

      expect(allowAllConsent.hasConsent).toHaveBeenCalledWith('org-1', 'contact-1', 'sms')
    })
  })

  describe('getHistory', () => {
    it('should return communication history with filters', async () => {
      const mockCommunications = [
        {
          id: 'comm-1',
          org_id: 'org-1',
          channel: 'email',
          direction: 'outbound',
          status: 'sent',
          attachments: [],
          metadata: {},
          created_at: '2024-01-02T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockCommunications).mockResolvedValueOnce([{ count: '1' }])

      const result = await service.getHistory({ orgId: 'org-1' })

      expect(result.communications).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it('should filter by channel', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.getHistory({ orgId: 'org-1', channel: 'sms' })

      expect(mockQuery.mock.calls[0][0]).toContain('channel = $')
    })

    it('should filter by contact', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.getHistory({ orgId: 'org-1', contactId: 'contact-1' })

      expect(mockQuery.mock.calls[0][0]).toContain('contact_id = $')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getHistory({ orgId: 'org-1' })).rejects.toThrow(DatabaseError)
    })
  })

  describe('getById', () => {
    it('should return communication by id', async () => {
      const mockCommunication = {
        id: 'comm-1',
        org_id: 'org-1',
        channel: 'email',
        direction: 'outbound',
        attachments: [],
        metadata: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockCommunication])

      const result = await service.getById('comm-1', 'org-1')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('comm-1')
    })

    it('should return null for non-existent communication', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getById('non-existent', 'org-1')

      expect(result).toBeNull()
    })
  })

  describe('scheduleFollowUp', () => {
    it('should schedule a follow-up', async () => {
      const mockFollowUp = {
        id: 'followup-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        channel: 'email',
        scheduled_for: '2024-12-01T10:00:00Z',
        sent: false,
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockFollowUp])

      const result = await service.scheduleFollowUp({
        orgId: 'org-1',
        contactId: 'contact-1',
        channel: 'email',
        scheduledFor: '2024-12-01T10:00:00Z'
      })

      expect(result.id).toBe('followup-1')
      expect(result.channel).toBe('email')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(
        service.scheduleFollowUp({
          orgId: 'org-1',
          contactId: 'contact-1',
          channel: 'email',
          scheduledFor: '2024-12-01T10:00:00Z'
        })
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('getPendingFollowUps', () => {
    it('should return pending follow-ups for contact', async () => {
      const mockFollowUps = [
        {
          id: 'followup-1',
          scheduled_for: '2024-12-01T10:00:00Z',
          channel: 'email',
          template_id: 'template-1'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockFollowUps)

      const result = await service.getPendingFollowUps('contact-1')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('followup-1')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getPendingFollowUps('contact-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('cancelFollowUp', () => {
    it('should cancel a follow-up', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.cancelFollowUp('followup-1')

      expect(result).toBe(true)
    })

    it('should return false when follow-up not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 } as unknown as [])

      const result = await service.cancelFollowUp('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('handleSendGridWebhook', () => {
    it('should update communication status on delivery', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'comm-1' }])
      mockQuery.mockResolvedValueOnce([])

      await service.handleSendGridWebhook({
        event: 'delivered',
        messageId: 'msg-123',
        timestamp: '2024-01-01T00:00:00Z'
      })

      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('should ignore unknown events', async () => {
      await service.handleSendGridWebhook({
        event: 'unknown_event',
        messageId: 'msg-123',
        timestamp: '2024-01-01T00:00:00Z'
      })

      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  describe('handleTwilioSMSWebhook', () => {
    it('should update communication status on delivery', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'comm-1' }])
      mockQuery.mockResolvedValueOnce([])

      await service.handleTwilioSMSWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'delivered'
      })

      expect(mockQuery).toHaveBeenCalledTimes(2)
    })
  })

  describe('handleTwilioCallWebhook', () => {
    it('should update call status and duration', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'comm-1' }])
      mockQuery.mockResolvedValueOnce([])

      await service.handleTwilioCallWebhook({
        CallSid: 'CA123',
        CallStatus: 'completed',
        Duration: '120'
      })

      expect(mockQuery).toHaveBeenCalledTimes(2)
    })
  })
})
