import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'crypto'
import { ApiKeyService, API_KEY_PREFIX } from '../../services/ApiKeyService'
import { ValidationError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('ApiKeyService', () => {
  let service: ApiKeyService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ApiKeyService()
  })

  describe('create', () => {
    it('mints a key, stores only the hash, and returns the plaintext once', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'key-1',
          org_id: 'org-1',
          name: 'acme-prod',
          key_prefix: 'prk_AAAAAAAA',
          role: 'user',
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          created_at: '2026-06-23T00:00:00Z'
        }
      ])

      const created = await service.create({ orgId: 'org-1', name: 'acme-prod' })

      // Plaintext key returned and well-formed
      expect(created.key).toMatch(new RegExp(`^${API_KEY_PREFIX}`))
      expect(created.id).toBe('key-1')
      expect(created.role).toBe('user')

      // The INSERT must persist the SHA-256 hash of the full key, never the plaintext
      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toContain('INSERT INTO api_keys')
      const storedHash = (params as unknown[])[3]
      expect(storedHash).toBe(sha256(created.key))
      expect(JSON.stringify(params)).not.toContain(created.key)
    })

    it('defaults role to user and rejects unknown roles via the param', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'key-2',
          org_id: 'org-1',
          name: 'admin-key',
          key_prefix: 'prk_BBBBBBBB',
          role: 'admin',
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          created_at: '2026-06-23T00:00:00Z'
        }
      ])

      const created = await service.create({ orgId: 'org-1', name: 'admin-key', role: 'admin' })
      expect(created.role).toBe('admin')
      expect((mockQuery.mock.calls[0][1] as unknown[])[4]).toBe('admin')
    })

    it('throws ValidationError on a blank name', async () => {
      await expect(service.create({ orgId: 'org-1', name: '   ' })).rejects.toBeInstanceOf(
        ValidationError
      )
      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  describe('verify', () => {
    it('returns null for a missing or wrong-prefix key without hitting the db', async () => {
      expect(await service.verify(undefined)).toBeNull()
      expect(await service.verify('not-a-key')).toBeNull()
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('resolves auth context for a valid key and stamps last_used_at', async () => {
      const key = `${API_KEY_PREFIX}secretsecret`
      mockQuery
        .mockResolvedValueOnce([
          { id: 'key-1', org_id: 'org-9', role: 'user', expires_at: null, revoked_at: null }
        ])
        .mockResolvedValueOnce([]) // the best-effort last_used_at UPDATE

      const result = await service.verify(key)

      expect(result).toEqual({ keyId: 'key-1', orgId: 'org-9', role: 'user' })

      // Lookup is by the hash of the presented key
      expect((mockQuery.mock.calls[0][1] as unknown[])[0]).toBe(sha256(key))
      // Usage stamp issued
      expect(mockQuery.mock.calls[1][0]).toContain('last_used_at = NOW()')
    })

    it('returns null for an unknown key', async () => {
      mockQuery.mockResolvedValueOnce([])
      expect(await service.verify(`${API_KEY_PREFIX}nope`)).toBeNull()
    })

    it('returns null for a revoked key', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'key-1',
          org_id: 'org-1',
          role: 'user',
          expires_at: null,
          revoked_at: '2026-06-01T00:00:00Z'
        }
      ])
      expect(await service.verify(`${API_KEY_PREFIX}revoked`)).toBeNull()
    })

    it('returns null for an expired key', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'key-1',
          org_id: 'org-1',
          role: 'user',
          expires_at: '2000-01-01T00:00:00Z',
          revoked_at: null
        }
      ])
      expect(await service.verify(`${API_KEY_PREFIX}expired`)).toBeNull()
    })

    it('still succeeds when the best-effort usage stamp write fails', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { id: 'key-1', org_id: 'org-1', role: 'admin', expires_at: null, revoked_at: null }
        ])
        .mockRejectedValueOnce(new Error('write failed'))

      const result = await service.verify(`${API_KEY_PREFIX}ok`)
      expect(result).toEqual({ keyId: 'key-1', orgId: 'org-1', role: 'admin' })
    })
  })

  describe('list', () => {
    it('returns org keys mapped to camelCase without secrets', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'key-1',
          org_id: 'org-1',
          name: 'k',
          key_prefix: 'prk_CCCCCCCC',
          role: 'user',
          last_used_at: '2026-06-22T00:00:00Z',
          expires_at: null,
          revoked_at: null,
          created_at: '2026-06-20T00:00:00Z'
        }
      ])

      const keys = await service.list('org-1')
      expect(keys).toHaveLength(1)
      expect(keys[0]).toMatchObject({ id: 'key-1', orgId: 'org-1', keyPrefix: 'prk_CCCCCCCC' })
      expect(keys[0]).not.toHaveProperty('key')
      expect(keys[0]).not.toHaveProperty('keyHash')
      expect((mockQuery.mock.calls[0][1] as unknown[])[0]).toBe('org-1')
    })
  })

  describe('revoke', () => {
    it('returns true when a key was revoked', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'key-1' }])
      expect(await service.revoke('org-1', 'key-1')).toBe(true)
      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toContain('revoked_at = COALESCE(revoked_at, NOW())')
      expect(params).toEqual(['key-1', 'org-1'])
    })

    it('returns false when no matching key exists for the org', async () => {
      mockQuery.mockResolvedValueOnce([])
      expect(await service.revoke('org-1', 'missing')).toBe(false)
    })
  })
})
