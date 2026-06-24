/**
 * ApiKeyService
 *
 * Issues and verifies long-lived, org-scoped API keys for the data-as-a-service
 * scrape endpoints. API keys are the credential an operator hands a paying
 * customer so they can call the API without an interactive JWT/IdP login.
 *
 * Security model:
 *  - The plaintext key (`prk_<secret>`) is returned EXACTLY ONCE at creation
 *    and never persisted. Only its SHA-256 hash is stored.
 *  - Verification hashes the presented key and does a single point lookup on
 *    the unique key_hash index, then checks revocation/expiry.
 *  - A short, non-secret prefix is stored for display ("which key is this?").
 *
 * @module server/services/ApiKeyService
 */

import crypto from 'crypto'
import { database } from '../database/connection'
import { ValidationError } from '../errors'

/** Prefix on every issued key; lets middleware cheaply distinguish keys from JWTs. */
export const API_KEY_PREFIX = 'prk_'

/** Number of leading characters (including the prefix) retained for display. */
const DISPLAY_PREFIX_LENGTH = 12

export type ApiKeyRole = 'user' | 'admin'

export interface ApiKeyRecord {
  id: string
  orgId: string
  name: string
  keyPrefix: string
  role: ApiKeyRole
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** Result of {@link ApiKeyService.create}: the record plus the one-time plaintext key. */
export interface CreatedApiKey extends ApiKeyRecord {
  /** Full plaintext key, shown once. Persist nothing about it server-side beyond the hash. */
  key: string
}

/** Auth context resolved from a verified key, shaped for the request `user`. */
export interface VerifiedApiKey {
  keyId: string
  orgId: string
  role: ApiKeyRole
}

interface ApiKeyRow {
  id: string
  org_id: string
  name: string
  key_prefix: string
  role: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

interface VerifyRow {
  id: string
  org_id: string
  role: string
  expires_at: string | null
  revoked_at: string | null
}

export interface CreateApiKeyInput {
  orgId: string
  name: string
  role?: ApiKeyRole
  /** Optional absolute expiry. Omit for a key that lives until revoked. */
  expiresAt?: Date | null
  /** Optional user id of the creator, recorded for the audit trail. */
  createdBy?: string | null
}

/** SHA-256 hex digest used for both storage and lookup of keys. */
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex')
}

function mapRow(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    role: row.role === 'admin' ? 'admin' : 'user',
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  }
}

export class ApiKeyService {
  /**
   * Mint a new API key for an organization. Returns the record plus the
   * one-time plaintext `key` — the caller MUST surface it to the user
   * immediately; it cannot be recovered later.
   */
  async create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const name = input.name?.trim()
    if (!name) {
      throw new ValidationError('API key name is required')
    }

    const role: ApiKeyRole = input.role === 'admin' ? 'admin' : 'user'
    const secret = crypto.randomBytes(32).toString('base64url')
    const key = `${API_KEY_PREFIX}${secret}`
    const keyHash = hashKey(key)
    const keyPrefix = key.slice(0, DISPLAY_PREFIX_LENGTH)

    const rows = await database.query<ApiKeyRow>(
      `INSERT INTO api_keys (org_id, name, key_prefix, key_hash, role, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, org_id, name, key_prefix, role, last_used_at, expires_at, revoked_at, created_at`,
      [
        input.orgId,
        name,
        keyPrefix,
        keyHash,
        role,
        input.expiresAt ?? null,
        input.createdBy ?? null
      ]
    )

    return { ...mapRow(rows[0]), key }
  }

  /**
   * Verify a presented key. Returns the auth context on success, or `null` if
   * the key is malformed, unknown, revoked, or expired. On success the key's
   * `last_used_at` is updated best-effort (failures are swallowed so a metering
   * write never blocks an otherwise-valid request).
   */
  async verify(presentedKey: string | undefined | null): Promise<VerifiedApiKey | null> {
    if (typeof presentedKey !== 'string' || !presentedKey.startsWith(API_KEY_PREFIX)) {
      return null
    }

    const keyHash = hashKey(presentedKey)
    const rows = await database.query<VerifyRow>(
      `SELECT id, org_id, role, expires_at, revoked_at
       FROM api_keys
       WHERE key_hash = $1`,
      [keyHash]
    )

    const row = rows[0]
    if (!row) return null
    if (row.revoked_at !== null) return null
    if (row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now()) {
      return null
    }

    // Best-effort usage stamp; never let a metering write fail the request.
    try {
      await database.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id])
    } catch {
      // ignore — verification already succeeded
    }

    return {
      keyId: row.id,
      orgId: row.org_id,
      role: row.role === 'admin' ? 'admin' : 'user'
    }
  }

  /** List an organization's keys (newest first). Never returns secrets/hashes. */
  async list(orgId: string): Promise<ApiKeyRecord[]> {
    const rows = await database.query<ApiKeyRow>(
      `SELECT id, org_id, name, key_prefix, role, last_used_at, expires_at, revoked_at, created_at
       FROM api_keys
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [orgId]
    )
    return rows.map(mapRow)
  }

  /**
   * Revoke a key by id within an org. Idempotent: re-revoking an already-revoked
   * key is a no-op that still resolves true. Returns false when no such key
   * exists for the org.
   */
  async revoke(orgId: string, keyId: string): Promise<boolean> {
    const rows = await database.query<{ id: string }>(
      `UPDATE api_keys
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE id = $1 AND org_id = $2
       RETURNING id`,
      [keyId, orgId]
    )
    return rows.length > 0
  }
}
