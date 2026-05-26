import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConsentService } from '../../services/ConsentService'
import { NotFoundError, ValidationError, DatabaseError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('ConsentService', () => {
  let service: ConsentService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ConsentService()
  })

  describe('recordConsent', () => {
    it('should record consent for a contact', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'all',
        is_granted: true,
        collection_method: 'web_form',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.recordConsent({
        orgId: 'org-1',
        contactId: 'contact-1',
        consentType: 'express_written',
        collectionMethod: 'web_form'
      })

      expect(result.id).toBe('consent-1')
      expect(result.consentType).toBe('express_written')
      expect(result.isGranted).toBe(true)
    })

    it('should record consent with IP and user agent', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'email',
        is_granted: true,
        collection_method: 'web_form',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.recordConsent({
        orgId: 'org-1',
        contactId: 'contact-1',
        consentType: 'express_written',
        channel: 'email',
        collectionMethod: 'web_form',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0'
      })

      expect(result.ipAddress).toBe('192.168.1.1')
      expect(result.userAgent).toBe('Mozilla/5.0')
    })

    it('should set expiration when expiresInDays provided', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'all',
        is_granted: true,
        collection_method: 'phone',
        expires_at: '2025-01-01T00:00:00Z',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.recordConsent({
        orgId: 'org-1',
        contactId: 'contact-1',
        consentType: 'express_written',
        collectionMethod: 'phone',
        expiresInDays: 365
      })

      expect(result.expiresAt).toBeDefined()
    })

    it('should throw ValidationError when contactId is missing', async () => {
      await expect(
        service.recordConsent({
          orgId: 'org-1',
          contactId: '',
          consentType: 'express_written',
          collectionMethod: 'web_form'
        })
      ).rejects.toThrow(ValidationError)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(
        service.recordConsent({
          orgId: 'org-1',
          contactId: 'contact-1',
          consentType: 'express_written',
          collectionMethod: 'web_form'
        })
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('hasConsent', () => {
    it('should return true when consent exists', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'email',
        is_granted: true,
        collection_method: 'web_form',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.hasConsent('org-1', 'contact-1', 'email')

      expect(result.hasConsent).toBe(true)
      expect(result.consentType).toBe('express_written')
    })

    it('should return false when no consent exists', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.hasConsent('org-1', 'contact-1', 'sms')

      expect(result.hasConsent).toBe(false)
    })

    it('should match "all" channel consent', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.hasConsent('org-1', 'contact-1', 'call')

      expect(mockQuery.mock.calls[0][0]).toContain("channel = 'all'")
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.hasConsent('org-1', 'contact-1', 'email')).rejects.toThrow(DatabaseError)
    })
  })

  describe('hasConsentOfType', () => {
    it('should check for specific consent type', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'prior_express',
        channel: 'call',
        is_granted: true,
        collection_method: 'phone',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.hasConsentOfType('org-1', 'contact-1', 'prior_express', 'call')

      expect(result.hasConsent).toBe(true)
      expect(result.consentType).toBe('prior_express')
    })

    it('should return false for wrong consent type', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.hasConsentOfType('org-1', 'contact-1', 'express_written', 'call')

      expect(result.hasConsent).toBe(false)
    })
  })

  describe('revokeConsent', () => {
    it('should revoke consent for a channel and record a channel-specific revocation marker', async () => {
      // Channel-specific revocation makes two writes: (1) revoke matching active
      // grants, (2) insert an explicit channel-scoped revocation marker so
      // hasConsent honors the opt-out even against an older 'all' grant.
      mockQuery
        .mockResolvedValueOnce({ rowCount: 2 } as unknown as [])
        .mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.revokeConsent(
        'org-1',
        'contact-1',
        'email',
        'Customer requested'
      )

      // 2 grants revoked + 1 marker inserted
      expect(result).toBe(3)
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('should not insert a marker when revoking all channels', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 4 } as unknown as [])

      const result = await service.revokeConsent('org-1', 'contact-1', 'all', 'Full opt-out')

      expect(result).toBe(4)
      // No marker insert for the broad 'all' revocation.
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('should return marker count when no active grant to revoke', async () => {
      // Even with no matching active grant, a channel-specific opt-out still
      // records a revocation marker so future sends are blocked.
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0 } as unknown as [])
        .mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.revokeConsent('org-1', 'contact-1', 'sms')

      expect(result).toBe(1)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Update failed'))

      await expect(service.revokeConsent('org-1', 'contact-1', 'email')).rejects.toThrow(
        DatabaseError
      )
    })
  })

  describe('revokeAllConsent', () => {
    it('should revoke all consents', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 5 } as unknown as [])

      const result = await service.revokeAllConsent('org-1', 'contact-1', 'Full opt-out')

      expect(result).toBe(5)
    })
  })

  describe('getForContact', () => {
    it('should return all consent records for a contact', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          org_id: 'org-1',
          contact_id: 'contact-1',
          consent_type: 'express_written',
          channel: 'email',
          is_granted: true,
          collection_method: 'web_form',
          granted_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'consent-2',
          org_id: 'org-1',
          contact_id: 'contact-1',
          consent_type: 'prior_express',
          channel: 'call',
          is_granted: true,
          collection_method: 'phone',
          granted_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockConsents)

      const result = await service.getForContact('org-1', 'contact-1')

      expect(result).toHaveLength(2)
    })

    it('should include revoked when requested', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.getForContact('org-1', 'contact-1', { includeRevoked: true })

      expect(mockQuery.mock.calls[0][0]).not.toContain('revoked_at IS NULL')
    })

    it('should exclude revoked by default', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.getForContact('org-1', 'contact-1')

      expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL')
    })
  })

  describe('getConsentSummary', () => {
    it('should return consent summary for all channels', async () => {
      const mockEmailConsent = {
        id: 'c1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'email',
        is_granted: true,
        collection_method: 'web',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery
        .mockResolvedValueOnce([mockEmailConsent]) // email check
        .mockResolvedValueOnce([]) // sms check
        .mockResolvedValueOnce([]) // call check
        .mockResolvedValueOnce([{ channel: 'call' }]) // revoked channels

      const result = await service.getConsentSummary('org-1', 'contact-1')

      expect(result.email.hasConsent).toBe(true)
      expect(result.sms.hasConsent).toBe(false)
      expect(result.call.hasConsent).toBe(false)
      expect(result.revokedChannels).toContain('call')
    })
  })

  describe('batchCheck', () => {
    it('should check consent for multiple contacts', async () => {
      mockQuery.mockResolvedValueOnce([{ contact_id: 'contact-1' }, { contact_id: 'contact-3' }])

      const result = await service.batchCheck(
        'org-1',
        ['contact-1', 'contact-2', 'contact-3'],
        'email'
      )

      expect(result.get('contact-1')).toBe(true)
      expect(result.get('contact-2')).toBe(false)
      expect(result.get('contact-3')).toBe(true)
    })

    it('should return empty map for empty input', async () => {
      const result = await service.batchCheck('org-1', [], 'email')

      expect(result.size).toBe(0)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.batchCheck('org-1', ['contact-1'], 'email')).rejects.toThrow(
        DatabaseError
      )
    })
  })

  describe('getContactsWithConsent', () => {
    it('should return contacts with specific consent type', async () => {
      mockQuery
        .mockResolvedValueOnce([{ contact_id: 'contact-1' }, { contact_id: 'contact-2' }])
        .mockResolvedValueOnce([{ count: '25' }])

      const result = await service.getContactsWithConsent('org-1', 'express_written', 'email')

      expect(result.contactIds).toHaveLength(2)
      expect(result.total).toBe(25)
    })

    it('should support pagination', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.getContactsWithConsent('org-1', 'express_written', 'email', {
        page: 2,
        limit: 50
      })

      expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $4 OFFSET $5')
    })
  })

  describe('getStats', () => {
    it('should return consent statistics', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: '100' }]) // total
        .mockResolvedValueOnce([
          { consent_type: 'express_written', count: '60' },
          { consent_type: 'prior_express', count: '40' }
        ])
        .mockResolvedValueOnce([
          { channel: 'email', count: '50' },
          { channel: 'all', count: '50' }
        ])
        .mockResolvedValueOnce([{ count: '5' }]) // recent opt-outs
        .mockResolvedValueOnce([{ count: '3' }]) // expiring

      const result = await service.getStats('org-1')

      expect(result.totalContacts).toBe(100)
      expect(result.byType.express_written).toBe(60)
      expect(result.byChannel.email).toBe(50)
      expect(result.recentOptOuts).toBe(5)
      expect(result.expiringInWeek).toBe(3)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getStats('org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('getById', () => {
    it('should return consent record by id', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'email',
        is_granted: true,
        collection_method: 'web_form',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.getById('consent-1', 'org-1')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('consent-1')
    })

    it('should return null for non-existent consent', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getById('non-existent', 'org-1')

      expect(result).toBeNull()
    })
  })

  describe('updateEvidence', () => {
    it('should update recording URL', async () => {
      const mockUpdated = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'prior_express',
        channel: 'call',
        is_granted: true,
        collection_method: 'phone',
        recording_url: 'https://storage.example.com/recording.mp3',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockUpdated])

      const result = await service.updateEvidence('consent-1', 'org-1', {
        recordingUrl: 'https://storage.example.com/recording.mp3'
      })

      expect(result.recordingUrl).toBe('https://storage.example.com/recording.mp3')
    })

    it('should return existing consent when no updates provided', async () => {
      const mockConsent = {
        id: 'consent-1',
        org_id: 'org-1',
        contact_id: 'contact-1',
        consent_type: 'express_written',
        channel: 'email',
        is_granted: true,
        collection_method: 'web_form',
        granted_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockConsent])

      const result = await service.updateEvidence('consent-1', 'org-1', {})

      expect(result.id).toBe('consent-1')
    })

    it('should throw NotFoundError for non-existent consent', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.updateEvidence('non-existent', 'org-1', {})).rejects.toThrow(
        NotFoundError
      )
    })
  })
})
