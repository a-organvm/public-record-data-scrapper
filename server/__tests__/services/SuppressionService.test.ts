import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SuppressionService } from '../../services/SuppressionService'
import { ValidationError, DatabaseError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('SuppressionService', () => {
  let service: SuppressionService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SuppressionService()
  })

  describe('isOnDNCList', () => {
    it('should return suppressed for phone on DNC list', async () => {
      const mockEntry = {
        id: 'dnc-1',
        org_id: 'org-1',
        phone: '1234567890',
        source: 'internal',
        channel: 'call',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockEntry])

      const result = await service.isOnDNCList('org-1', '1234567890', 'call')

      expect(result.isSuppressed).toBe(true)
      expect(result.source).toBe('internal')
    })

    it('should return not suppressed for phone not on list', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.isOnDNCList('org-1', '1234567890', 'call')

      expect(result.isSuppressed).toBe(false)
    })

    it('should normalize phone numbers', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.isOnDNCList('org-1', '(123) 456-7890', 'call')

      expect(mockQuery.mock.calls[0][1]).toContain('1234567890')
    })

    it('should handle 11-digit phone with country code', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.isOnDNCList('org-1', '+1 (123) 456-7890', 'call')

      expect(mockQuery.mock.calls[0][1]).toContain('1234567890')
    })

    it('should return not suppressed for invalid phone', async () => {
      const result = await service.isOnDNCList('org-1', '123', 'call')

      expect(result.isSuppressed).toBe(false)
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('should check against channel-specific entries', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.isOnDNCList('org-1', '1234567890', 'sms')

      expect(mockQuery.mock.calls[0][0]).toContain('channel = $3')
      expect(mockQuery.mock.calls[0][1]).toContain('sms')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.isOnDNCList('org-1', '1234567890')).rejects.toThrow(DatabaseError)
    })
  })

  describe('isEmailSuppressed', () => {
    it('should return suppressed for email on list', async () => {
      const mockEntry = {
        id: 'dnc-1',
        org_id: 'org-1',
        email: 'test@example.com',
        source: 'complaint',
        channel: 'email',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockEntry])

      const result = await service.isEmailSuppressed('org-1', 'test@example.com')

      expect(result.isSuppressed).toBe(true)
    })

    it('should normalize email to lowercase', async () => {
      mockQuery.mockResolvedValueOnce([])

      await service.isEmailSuppressed('org-1', 'TEST@EXAMPLE.COM')

      expect(mockQuery.mock.calls[0][1]).toContain('test@example.com')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.isEmailSuppressed('org-1', 'test@example.com')).rejects.toThrow(
        DatabaseError
      )
    })
  })

  describe('batchCheck', () => {
    it('should check multiple phones', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // First phone not suppressed
        .mockResolvedValueOnce([
          {
            id: 'dnc-1',
            org_id: 'org-1',
            phone: '2345678901',
            source: 'internal',
            channel: 'call',
            created_at: '2024-01-01T00:00:00Z'
          }
        ]) // Second phone suppressed

      const result = await service.batchCheck('org-1', {
        phones: ['1234567890', '2345678901']
      })

      expect(result.totalChecked).toBe(2)
      expect(result.suppressedCount).toBe(1)
    })

    it('should check multiple emails', async () => {
      mockQuery
        .mockResolvedValueOnce([
          {
            id: 'dnc-1',
            org_id: 'org-1',
            email: 'bad@example.com',
            source: 'complaint',
            channel: 'email',
            created_at: '2024-01-01T00:00:00Z'
          }
        ])
        .mockResolvedValueOnce([])

      const result = await service.batchCheck('org-1', {
        emails: ['bad@example.com', 'good@example.com']
      })

      expect(result.totalChecked).toBe(2)
      expect(result.suppressedCount).toBe(1)
    })

    it('should check both phones and emails', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.batchCheck('org-1', {
        phones: ['1234567890'],
        emails: ['test@example.com']
      })

      expect(result.totalChecked).toBe(2)
    })
  })

  describe('addToSuppressionList', () => {
    it('should add phone to suppression list', async () => {
      const mockEntry = {
        id: 'dnc-1',
        org_id: 'org-1',
        phone: '1234567890',
        source: 'internal',
        channel: 'all',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery
        .mockResolvedValueOnce([]) // Check existing
        .mockResolvedValueOnce([mockEntry]) // Insert

      const result = await service.addToSuppressionList({
        orgId: 'org-1',
        phone: '1234567890'
      })

      expect(result.id).toBe('dnc-1')
      expect(result.phone).toBe('1234567890')
    })

    it('should add email to suppression list', async () => {
      const mockEntry = {
        id: 'dnc-1',
        org_id: 'org-1',
        email: 'test@example.com',
        source: 'internal',
        channel: 'all',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([mockEntry])

      const result = await service.addToSuppressionList({
        orgId: 'org-1',
        email: 'test@example.com'
      })

      expect(result.email).toBe('test@example.com')
    })

    it('should update existing entry', async () => {
      const existingEntry = {
        id: 'dnc-1',
        org_id: 'org-1',
        phone: '1234567890',
        source: 'internal',
        channel: 'call',
        created_at: '2024-01-01T00:00:00Z'
      }
      const updatedEntry = {
        ...existingEntry,
        source: 'complaint',
        reason: 'Customer requested removal'
      }

      mockQuery.mockResolvedValueOnce([existingEntry]).mockResolvedValueOnce([updatedEntry])

      const result = await service.addToSuppressionList({
        orgId: 'org-1',
        phone: '1234567890',
        source: 'complaint',
        reason: 'Customer requested removal'
      })

      expect(result.source).toBe('complaint')
    })

    it('should throw ValidationError when neither phone nor email provided', async () => {
      await expect(service.addToSuppressionList({ orgId: 'org-1' })).rejects.toThrow(
        ValidationError
      )
    })

    it('should set expiration when expiresInDays provided', async () => {
      const mockEntry = {
        id: 'dnc-1',
        org_id: 'org-1',
        phone: '1234567890',
        source: 'internal',
        channel: 'all',
        expires_at: '2024-12-31T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([mockEntry])

      const result = await service.addToSuppressionList({
        orgId: 'org-1',
        phone: '1234567890',
        expiresInDays: 365
      })

      expect(result.expiresAt).toBeDefined()
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(
        service.addToSuppressionList({ orgId: 'org-1', phone: '1234567890' })
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('removeFromSuppressionList', () => {
    it('should remove phone from list', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.removeFromSuppressionList('org-1', '1234567890')

      expect(result).toBe(true)
    })

    it('should remove email from list', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.removeFromSuppressionList('org-1', 'test@example.com')

      expect(result).toBe(true)
    })

    it('should return false when entry not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 } as unknown as [])

      const result = await service.removeFromSuppressionList('org-1', '9999999999')

      expect(result).toBe(false)
    })

    it('should remove for specific channel', async () => {
      // Channel-specific removal: (1) delete exact-channel rows, (2) query for
      // overlapping 'all' entries to narrow (here none exist).
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1 } as unknown as [])
        .mockResolvedValueOnce([])

      const result = await service.removeFromSuppressionList('org-1', '1234567890', 'sms')

      expect(result).toBe(true)
      expect(mockQuery.mock.calls[0][0]).toContain('channel = $3')
    })

    it('should narrow an overlapping "all" entry when removing a specific channel', async () => {
      const allEntry = {
        id: 'dnc-all',
        org_id: 'org-1',
        phone: '1234567890',
        source: 'internal',
        channel: 'all',
        created_at: '2024-01-01T00:00:00Z'
      }
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0 } as unknown as []) // exact-channel delete
        .mockResolvedValueOnce([allEntry]) // find 'all' entries
        .mockResolvedValueOnce({ rowCount: 1 } as unknown as []) // delete the 'all' row
        .mockResolvedValueOnce({ rowCount: 1 } as unknown as []) // re-insert remaining channel #1
        .mockResolvedValueOnce({ rowCount: 1 } as unknown as []) // re-insert remaining channel #2

      const result = await service.removeFromSuppressionList('org-1', '1234567890', 'sms')

      expect(result).toBe(true)
      // The broad 'all' row is deleted and replaced with explicit entries for
      // the other two channels (call, email).
      const insertCalls = mockQuery.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO dnc_list')
      )
      expect(insertCalls.length).toBe(2)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Delete failed'))

      await expect(service.removeFromSuppressionList('org-1', '1234567890')).rejects.toThrow(
        DatabaseError
      )
    })
  })

  describe('list', () => {
    it('should return paginated suppression entries', async () => {
      const mockEntries = [
        {
          id: 'dnc-1',
          org_id: 'org-1',
          phone: '1234567890',
          source: 'internal',
          channel: 'all',
          created_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockEntries).mockResolvedValueOnce([{ count: '1' }])

      const result = await service.list('org-1')

      expect(result.entries).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it('should filter by source', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list('org-1', { source: 'federal_dnc' })

      expect(mockQuery.mock.calls[0][0]).toContain('source = $')
    })

    it('should filter by channel', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list('org-1', { channel: 'sms' })

      expect(mockQuery.mock.calls[0][0]).toContain('channel = $')
    })

    it('should include expired entries when requested', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list('org-1', { includeExpired: true })

      expect(mockQuery.mock.calls[0][0]).not.toContain(
        'expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP'
      )
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.list('org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('syncFTCList', () => {
    it('should return not_configured status', async () => {
      const result = await service.syncFTCList('org-1')

      expect(result.status).toBe('not_configured')
      expect(result.message).toContain('not configured')
    })
  })

  describe('bulkImport', () => {
    it('should import multiple entries', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'dnc-1',
            org_id: 'org-1',
            phone: '1234567890',
            source: 'imported',
            channel: 'all',
            created_at: '2024-01-01T00:00:00Z'
          }
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'dnc-2',
            org_id: 'org-1',
            phone: '2345678901',
            source: 'imported',
            channel: 'all',
            created_at: '2024-01-01T00:00:00Z'
          }
        ])

      const result = await service.bulkImport('org-1', [
        { phone: '1234567890' },
        { phone: '2345678901' }
      ])

      expect(result.imported).toBe(2)
      expect(result.skipped).toBe(0)
    })

    it('should skip entries without phone or email', async () => {
      const result = await service.bulkImport('org-1', [{}, { reason: 'No contact info' }])

      expect(result.skipped).toBe(2)
    })

    it('should collect errors', async () => {
      mockQuery.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Insert failed'))

      const result = await service.bulkImport('org-1', [{ phone: '1234567890' }])

      expect(result.errors.length).toBe(1)
    })
  })

  describe('getStats', () => {
    it('should return suppression statistics', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: '100' }])
        .mockResolvedValueOnce([
          { source: 'internal', count: '50' },
          { source: 'federal_dnc', count: '50' }
        ])
        .mockResolvedValueOnce([
          { channel: 'call', count: '60' },
          { channel: 'all', count: '40' }
        ])
        .mockResolvedValueOnce([{ count: '5' }])

      const result = await service.getStats('org-1')

      expect(result.totalEntries).toBe(100)
      expect(result.bySource.internal).toBe(50)
      expect(result.byChannel.call).toBe(60)
      expect(result.expiringInWeek).toBe(5)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getStats('org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('cleanupExpired', () => {
    it('should delete expired entries', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 10 } as unknown as [])

      const result = await service.cleanupExpired('org-1')

      expect(result).toBe(10)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Delete failed'))

      await expect(service.cleanupExpired('org-1')).rejects.toThrow(DatabaseError)
    })
  })
})
