/**
 * ConsentService
 *
 * Tracks TCPA consent for communications. Manages opt-in and opt-out
 * for various communication channels and consent types.
 *
 * Features:
 * - Record consent with evidence (IP, user agent, form data)
 * - Check consent status before sending communications
 * - Handle opt-out/revocation
 * - Support multiple consent types (express, prior express, transactional)
 */

import { database } from '../database/connection'
import { NotFoundError, ValidationError, DatabaseError } from '../errors'
import type {
  ConsentRecord,
  ConsentType,
  CollectionMethod,
  CommunicationChannel
} from '@public-records/core'

// Extended channel type for consent (includes 'mail' and 'all')
type ConsentChannel = CommunicationChannel | 'mail' | 'all'

// Database row type
interface ConsentRecordRow {
  id: string
  org_id: string
  contact_id: string
  consent_type: string
  channel?: string
  is_granted: boolean
  consent_text?: string
  consent_version?: string
  collection_method: string
  collection_url?: string
  recording_url?: string
  document_url?: string
  ip_address?: string
  user_agent?: string
  evidence?: Record<string, unknown>
  granted_at: string
  expires_at?: string
  revoked_at?: string
  revoked_reason?: string
  collected_by?: string
  created_at: string
}

// Input for recording consent
interface RecordConsentInput {
  orgId: string
  contactId: string
  consentType: ConsentType
  channel?: ConsentChannel
  isGranted?: boolean
  consentText?: string
  consentVersion?: string
  collectionMethod: CollectionMethod
  collectionUrl?: string
  recordingUrl?: string
  documentUrl?: string
  ipAddress?: string
  userAgent?: string
  evidence?: Record<string, unknown>
  expiresInDays?: number
  collectedBy?: string
}

// Consent check result
interface ConsentCheckResult {
  hasConsent: boolean
  consentType?: ConsentType
  grantedAt?: string
  expiresAt?: string
  consentRecord?: ConsentRecord
}

export class ConsentService {
  /**
   * Transform database row to ConsentRecord type
   */
  private transformConsent(row: ConsentRecordRow): ConsentRecord {
    return {
      id: row.id,
      orgId: row.org_id,
      contactId: row.contact_id,
      consentType: row.consent_type as ConsentType,
      channel: row.channel as ConsentChannel,
      isGranted: row.is_granted,
      consentText: row.consent_text,
      consentVersion: row.consent_version,
      collectionMethod: row.collection_method as CollectionMethod,
      collectionUrl: row.collection_url,
      recordingUrl: row.recording_url,
      documentUrl: row.document_url,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      evidence: row.evidence,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
      collectedBy: row.collected_by,
      createdAt: row.created_at
    }
  }

  /**
   * Record consent for a contact
   */
  async recordConsent(input: RecordConsentInput): Promise<ConsentRecord> {
    if (!input.contactId) {
      throw new ValidationError('Contact ID is required')
    }

    // Calculate expiration if specified
    let expiresAt: string | null = null
    if (input.expiresInDays) {
      const expDate = new Date()
      expDate.setDate(expDate.getDate() + input.expiresInDays)
      expiresAt = expDate.toISOString()
    }

    try {
      const results = await database.query<ConsentRecordRow>(
        `INSERT INTO consent_records (
          org_id, contact_id, consent_type, channel, is_granted,
          consent_text, consent_version, collection_method,
          collection_url, recording_url, document_url,
          ip_address, user_agent, evidence,
          granted_at, expires_at, collected_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::inet, $13, $14, $15, $16, $17)
        RETURNING *`,
        [
          input.orgId,
          input.contactId,
          input.consentType,
          input.channel || 'all',
          input.isGranted ?? true,
          input.consentText,
          input.consentVersion,
          input.collectionMethod,
          input.collectionUrl,
          input.recordingUrl,
          input.documentUrl,
          input.ipAddress || null,
          input.userAgent,
          input.evidence ? JSON.stringify(input.evidence) : null,
          new Date().toISOString(),
          expiresAt,
          input.collectedBy
        ]
      )

      return this.transformConsent(results[0])
    } catch (error) {
      throw new DatabaseError(
        'Failed to record consent',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if a contact has consent for a specific channel
   */
  async hasConsent(
    orgId: string,
    contactId: string,
    channel: ConsentChannel
  ): Promise<ConsentCheckResult> {
    try {
      // Look for the most recent active grant that covers the requested channel.
      // A grant only counts if there is NO later revocation that applies to this
      // channel — a revocation of a specific channel (or 'all') must win over an
      // older 'all' grant. We compare against the revocation timestamp so that a
      // newer re-grant can still re-establish consent.
      const results = await database.query<ConsentRecordRow>(
        `SELECT * FROM consent_records cr
        WHERE cr.org_id = $1
          AND cr.contact_id = $2
          AND (cr.channel = $3 OR cr.channel = 'all')
          AND cr.is_granted = true
          AND cr.revoked_at IS NULL
          AND (cr.expires_at IS NULL OR cr.expires_at > CURRENT_TIMESTAMP)
          AND NOT EXISTS (
            SELECT 1 FROM consent_records rev
            WHERE rev.org_id = cr.org_id
              AND rev.contact_id = cr.contact_id
              AND (rev.channel = $3 OR rev.channel = 'all')
              AND rev.revoked_at IS NOT NULL
              AND rev.revoked_at >= cr.granted_at
          )
        ORDER BY cr.granted_at DESC
        LIMIT 1`,
        [orgId, contactId, channel]
      )

      if (results[0]) {
        const record = this.transformConsent(results[0])
        return {
          hasConsent: true,
          consentType: record.consentType,
          grantedAt: record.grantedAt,
          expiresAt: record.expiresAt,
          consentRecord: record
        }
      }

      return { hasConsent: false }
    } catch (error) {
      throw new DatabaseError(
        'Failed to check consent',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check consent for specific type and channel
   * Used for stricter TCPA compliance (e.g., marketing vs transactional)
   */
  async hasConsentOfType(
    orgId: string,
    contactId: string,
    consentType: ConsentType,
    channel: ConsentChannel
  ): Promise<ConsentCheckResult> {
    try {
      const results = await database.query<ConsentRecordRow>(
        `SELECT * FROM consent_records
        WHERE org_id = $1
          AND contact_id = $2
          AND consent_type = $3
          AND (channel = $4 OR channel = 'all')
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY granted_at DESC
        LIMIT 1`,
        [orgId, contactId, consentType, channel]
      )

      if (results[0]) {
        const record = this.transformConsent(results[0])
        return {
          hasConsent: true,
          consentType: record.consentType,
          grantedAt: record.grantedAt,
          expiresAt: record.expiresAt,
          consentRecord: record
        }
      }

      return { hasConsent: false }
    } catch (error) {
      throw new DatabaseError(
        'Failed to check consent of type',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Revoke consent (opt-out)
   */
  async revokeConsent(
    orgId: string,
    contactId: string,
    channel: ConsentChannel,
    reason?: string
  ): Promise<number> {
    try {
      // Revoke active grants that explicitly match the requested channel.
      // When revoking a broad 'all' opt-out, also revoke every active grant
      // regardless of channel.
      const channelMatch =
        channel === 'all'
          ? `cr.channel IS NOT NULL`
          : `cr.channel = $3`

      const updateResults = await database.query(
        `UPDATE consent_records AS cr
        SET revoked_at = CURRENT_TIMESTAMP,
            revoked_reason = $4
        WHERE cr.org_id = $1
          AND cr.contact_id = $2
          AND (${channelMatch} OR cr.channel = 'all')
          AND cr.is_granted = true
          AND cr.revoked_at IS NULL`,
        [orgId, contactId, channel, reason]
      )

      let affected = (updateResults as { rowCount: number }).rowCount

      // For a channel-specific revocation, also record an explicit revocation
      // marker scoped to that channel. This ensures hasConsent() honors the
      // opt-out even when consent was only ever granted via a broad 'all' grant:
      // the revocation marker overrides the older 'all' grant for this channel
      // while leaving the 'all' grant intact for other channels.
      if (channel !== 'all') {
        const markerResults = await database.query(
          `INSERT INTO consent_records (
            org_id, contact_id, consent_type, channel, is_granted,
            collection_method, granted_at, revoked_at, revoked_reason
          ) VALUES ($1, $2, 'transactional', $3, false, 'imported', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)`,
          [orgId, contactId, channel, reason]
        )
        affected += (markerResults as { rowCount: number }).rowCount
      }

      return affected
    } catch (error) {
      throw new DatabaseError(
        'Failed to revoke consent',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Revoke all consents for a contact (full opt-out)
   */
  async revokeAllConsent(
    orgId: string,
    contactId: string,
    reason?: string
  ): Promise<number> {
    return this.revokeConsent(orgId, contactId, 'all', reason)
  }

  /**
   * Get all consent records for a contact
   */
  async getForContact(
    orgId: string,
    contactId: string,
    options: { includeRevoked?: boolean } = {}
  ): Promise<ConsentRecord[]> {
    const { includeRevoked = false } = options

    try {
      let query = `
        SELECT * FROM consent_records
        WHERE org_id = $1 AND contact_id = $2
      `

      if (!includeRevoked) {
        query += ` AND revoked_at IS NULL`
      }

      query += ` ORDER BY granted_at DESC`

      const results = await database.query<ConsentRecordRow>(query, [orgId, contactId])
      return results.map(this.transformConsent)
    } catch (error) {
      throw new DatabaseError(
        'Failed to get consent records for contact',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get consent status summary for a contact
   */
  async getConsentSummary(
    orgId: string,
    contactId: string
  ): Promise<{
    email: { hasConsent: boolean; type?: ConsentType; grantedAt?: string }
    sms: { hasConsent: boolean; type?: ConsentType; grantedAt?: string }
    call: { hasConsent: boolean; type?: ConsentType; grantedAt?: string }
    revokedChannels: ConsentChannel[]
  }> {
    const [email, sms, call] = await Promise.all([
      this.hasConsent(orgId, contactId, 'email'),
      this.hasConsent(orgId, contactId, 'sms'),
      this.hasConsent(orgId, contactId, 'call')
    ])

    // Get revoked channels
    const revokedResults = await database.query<{ channel: string }>(
      `SELECT DISTINCT channel FROM consent_records
      WHERE org_id = $1 AND contact_id = $2 AND revoked_at IS NOT NULL`,
      [orgId, contactId]
    )

    return {
      email: {
        hasConsent: email.hasConsent,
        type: email.consentType,
        grantedAt: email.grantedAt
      },
      sms: {
        hasConsent: sms.hasConsent,
        type: sms.consentType,
        grantedAt: sms.grantedAt
      },
      call: {
        hasConsent: call.hasConsent,
        type: call.consentType,
        grantedAt: call.grantedAt
      },
      revokedChannels: revokedResults.map((r) => r.channel as ConsentChannel)
    }
  }

  /**
   * Batch check consent for multiple contacts
   */
  async batchCheck(
    orgId: string,
    contactIds: string[],
    channel: ConsentChannel
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()

    // Initialize all as false
    for (const id of contactIds) {
      results.set(id, false)
    }

    if (contactIds.length === 0) {
      return results
    }

    try {
      // Build parameterized query for batch lookup
      const placeholders = contactIds.map((_, i) => `$${i + 3}`).join(',')

      const rows = await database.query<{ contact_id: string }>(
        `SELECT DISTINCT contact_id FROM consent_records
        WHERE org_id = $1
          AND contact_id IN (${placeholders})
          AND (channel = $2 OR channel = 'all')
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [orgId, channel, ...contactIds]
      )

      // Mark those with consent
      for (const row of rows) {
        results.set(row.contact_id, true)
      }

      return results
    } catch (error) {
      throw new DatabaseError(
        'Failed to batch check consent',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get contacts with specific consent type (for marketing campaigns)
   */
  async getContactsWithConsent(
    orgId: string,
    consentType: ConsentType,
    channel: ConsentChannel,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
    contactIds: string[]
    total: number
    page: number
    limit: number
  }> {
    const { page = 1, limit = 100 } = options
    const offset = (page - 1) * limit

    try {
      const results = await database.query<{ contact_id: string }>(
        `SELECT DISTINCT contact_id FROM consent_records
        WHERE org_id = $1
          AND consent_type = $2
          AND (channel = $3 OR channel = 'all')
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT $4 OFFSET $5`,
        [orgId, consentType, channel, limit, offset]
      )

      const countResult = await database.query<{ count: string }>(
        `SELECT COUNT(DISTINCT contact_id) as count FROM consent_records
        WHERE org_id = $1
          AND consent_type = $2
          AND (channel = $3 OR channel = 'all')
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [orgId, consentType, channel]
      )

      return {
        contactIds: results.map((r) => r.contact_id),
        total: parseInt(countResult[0]?.count || '0'),
        page,
        limit
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to get contacts with consent',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get consent statistics for an organization
   */
  async getStats(orgId: string): Promise<{
    totalContacts: number
    byType: Record<string, number>
    byChannel: Record<string, number>
    recentOptOuts: number
    expiringInWeek: number
  }> {
    try {
      // Total contacts with active consent
      const totalResult = await database.query<{ count: string }>(
        `SELECT COUNT(DISTINCT contact_id) as count FROM consent_records
        WHERE org_id = $1
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [orgId]
      )

      // By consent type
      const byTypeResult = await database.query<{ consent_type: string; count: string }>(
        `SELECT consent_type, COUNT(DISTINCT contact_id) as count
        FROM consent_records
        WHERE org_id = $1
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        GROUP BY consent_type`,
        [orgId]
      )

      // By channel
      const byChannelResult = await database.query<{ channel: string; count: string }>(
        `SELECT channel, COUNT(DISTINCT contact_id) as count
        FROM consent_records
        WHERE org_id = $1
          AND is_granted = true
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        GROUP BY channel`,
        [orgId]
      )

      // Recent opt-outs (last 7 days)
      const optOutResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM consent_records
        WHERE org_id = $1
          AND revoked_at > CURRENT_TIMESTAMP - INTERVAL '7 days'`,
        [orgId]
      )

      // Expiring in next week
      const expiringResult = await database.query<{ count: string }>(
        `SELECT COUNT(DISTINCT contact_id) as count FROM consent_records
        WHERE org_id = $1
          AND is_granted = true
          AND revoked_at IS NULL
          AND expires_at IS NOT NULL
          AND expires_at > CURRENT_TIMESTAMP
          AND expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days'`,
        [orgId]
      )

      const byType: Record<string, number> = {}
      for (const row of byTypeResult) {
        byType[row.consent_type] = parseInt(row.count)
      }

      const byChannel: Record<string, number> = {}
      for (const row of byChannelResult) {
        byChannel[row.channel] = parseInt(row.count)
      }

      return {
        totalContacts: parseInt(totalResult[0]?.count || '0'),
        byType,
        byChannel,
        recentOptOuts: parseInt(optOutResult[0]?.count || '0'),
        expiringInWeek: parseInt(expiringResult[0]?.count || '0')
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to get consent stats',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get a consent record by ID
   */
  async getById(id: string, orgId: string): Promise<ConsentRecord | null> {
    try {
      const results = await database.query<ConsentRecordRow>(
        'SELECT * FROM consent_records WHERE id = $1 AND org_id = $2',
        [id, orgId]
      )
      return results[0] ? this.transformConsent(results[0]) : null
    } catch (error) {
      throw new DatabaseError(
        'Failed to get consent record',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Update consent evidence (for adding recording URL, etc.)
   */
  async updateEvidence(
    id: string,
    orgId: string,
    evidence: Partial<{
      recordingUrl: string
      documentUrl: string
      additionalEvidence: Record<string, unknown>
    }>
  ): Promise<ConsentRecord> {
    const updates: string[] = []
    const values: unknown[] = [id, orgId]
    let paramCount = 3

    if (evidence.recordingUrl) {
      updates.push(`recording_url = $${paramCount++}`)
      values.push(evidence.recordingUrl)
    }

    if (evidence.documentUrl) {
      updates.push(`document_url = $${paramCount++}`)
      values.push(evidence.documentUrl)
    }

    if (evidence.additionalEvidence) {
      updates.push(`evidence = COALESCE(evidence, '{}'::jsonb) || $${paramCount++}::jsonb`)
      values.push(JSON.stringify(evidence.additionalEvidence))
    }

    if (updates.length === 0) {
      const existing = await this.getById(id, orgId)
      if (!existing) {
        throw new NotFoundError('ConsentRecord', id)
      }
      return existing
    }

    try {
      const results = await database.query<ConsentRecordRow>(
        `UPDATE consent_records
        SET ${updates.join(', ')}
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
        values
      )

      if (!results[0]) {
        throw new NotFoundError('ConsentRecord', id)
      }

      return this.transformConsent(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to update consent evidence',
        error instanceof Error ? error : undefined
      )
    }
  }
}

// Export singleton instance
export const consentService = new ConsentService()
