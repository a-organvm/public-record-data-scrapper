/**
 * SuppressionService (DNC - Do Not Call/Contact)
 *
 * Manages phone number and email suppression lists for compliance.
 * Checks contact information against DNC lists before outbound communications.
 *
 * Features:
 * - Check phone numbers against internal and federal DNC lists
 * - Add/remove numbers from suppression lists
 * - Sync with FTC National DNC Registry (subscription-gated integration)
 * - Support for multiple channels (call, sms, email)
 */

import { database } from '../database/connection'
import { ValidationError, DatabaseError } from '../errors'

// DNC source types
export type DNCSource = 'federal_dnc' | 'state_dnc' | 'internal' | 'complaint' | 'imported'

// Communication channels
export type DNCChannel = 'call' | 'sms' | 'email' | 'all'

// Database row type
interface DNCListRow {
  id: string
  org_id: string
  phone?: string
  email?: string
  source: string
  channel: string
  reason?: string
  added_by?: string
  expires_at?: string
  created_at: string
}

// DNC entry type
export interface DNCEntry {
  id: string
  orgId: string
  phone?: string
  email?: string
  source: DNCSource
  channel: DNCChannel
  reason?: string
  addedBy?: string
  expiresAt?: string
  createdAt: string
}

// Check result
export interface SuppressionCheckResult {
  isSuppressed: boolean
  channel?: DNCChannel
  source?: DNCSource
  reason?: string
  expiresAt?: string
  entry?: DNCEntry
}

// Add to suppression list input
interface AddSuppressionInput {
  orgId: string
  phone?: string
  email?: string
  source?: DNCSource
  channel?: DNCChannel
  reason?: string
  addedBy?: string
  expiresInDays?: number
}

// Batch check input
interface BatchCheckInput {
  phones?: string[]
  emails?: string[]
  channel?: DNCChannel
}

// Batch check result
interface BatchCheckResult {
  results: Map<string, SuppressionCheckResult>
  suppressedCount: number
  totalChecked: number
}

export class SuppressionService {
  /**
   * Transform database row to DNCEntry type
   */
  private transformEntry(row: DNCListRow): DNCEntry {
    return {
      id: row.id,
      orgId: row.org_id,
      phone: row.phone,
      email: row.email,
      source: row.source as DNCSource,
      channel: row.channel as DNCChannel,
      reason: row.reason,
      addedBy: row.added_by,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }
  }

  /**
   * Normalize phone number for consistent lookup
   * Strips non-digits and ensures 10 digit format
   */
  private normalizePhone(phone: string): string {
    // Remove all non-digits
    let normalized = phone.replace(/\D/g, '')

    // Remove leading 1 if 11 digits (US country code)
    if (normalized.length === 11 && normalized.startsWith('1')) {
      normalized = normalized.substring(1)
    }

    return normalized
  }

  /**
   * Normalize email for consistent lookup
   */
  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim()
  }

  /**
   * Check if a phone number is on the DNC list
   */
  async isOnDNCList(
    orgId: string,
    phone: string,
    channel: DNCChannel = 'call'
  ): Promise<SuppressionCheckResult> {
    const normalizedPhone = this.normalizePhone(phone)

    if (!normalizedPhone || normalizedPhone.length < 10) {
      return { isSuppressed: false }
    }

    try {
      const results = await database.query<DNCListRow>(
        `SELECT * FROM dnc_list
        WHERE org_id = $1
          AND phone = $2
          AND (channel = $3 OR channel = 'all')
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1`,
        [orgId, normalizedPhone, channel]
      )

      if (results[0]) {
        const entry = this.transformEntry(results[0])
        return {
          isSuppressed: true,
          channel: entry.channel,
          source: entry.source,
          reason: entry.reason,
          expiresAt: entry.expiresAt,
          entry
        }
      }

      return { isSuppressed: false }
    } catch (error) {
      throw new DatabaseError(
        'Failed to check DNC list',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if an email is on the suppression list
   */
  async isEmailSuppressed(orgId: string, email: string): Promise<SuppressionCheckResult> {
    const normalizedEmail = this.normalizeEmail(email)

    try {
      const results = await database.query<DNCListRow>(
        `SELECT * FROM dnc_list
        WHERE org_id = $1
          AND email = $2
          AND (channel = 'email' OR channel = 'all')
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1`,
        [orgId, normalizedEmail]
      )

      if (results[0]) {
        const entry = this.transformEntry(results[0])
        return {
          isSuppressed: true,
          channel: entry.channel,
          source: entry.source,
          reason: entry.reason,
          expiresAt: entry.expiresAt,
          entry
        }
      }

      return { isSuppressed: false }
    } catch (error) {
      throw new DatabaseError(
        'Failed to check email suppression',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Batch check multiple phone numbers and emails
   */
  async batchCheck(orgId: string, input: BatchCheckInput): Promise<BatchCheckResult> {
    const results = new Map<string, SuppressionCheckResult>()
    let suppressedCount = 0

    // Check phones
    if (input.phones?.length) {
      for (const phone of input.phones) {
        const result = await this.isOnDNCList(orgId, phone, input.channel || 'call')
        results.set(phone, result)
        if (result.isSuppressed) suppressedCount++
      }
    }

    // Check emails
    if (input.emails?.length) {
      for (const email of input.emails) {
        const result = await this.isEmailSuppressed(orgId, email)
        results.set(email, result)
        if (result.isSuppressed) suppressedCount++
      }
    }

    return {
      results,
      suppressedCount,
      totalChecked: (input.phones?.length || 0) + (input.emails?.length || 0)
    }
  }

  /**
   * Add a phone number or email to the suppression list
   */
  async addToSuppressionList(input: AddSuppressionInput): Promise<DNCEntry> {
    // Validate at least one identifier
    if (!input.phone && !input.email) {
      throw new ValidationError('Either phone or email is required')
    }

    const normalizedPhone = input.phone ? this.normalizePhone(input.phone) : null
    const normalizedEmail = input.email ? this.normalizeEmail(input.email) : null

    // Calculate expiration if specified
    let expiresAt: string | null = null
    if (input.expiresInDays) {
      const expDate = new Date()
      expDate.setDate(expDate.getDate() + input.expiresInDays)
      expiresAt = expDate.toISOString()
    }

    try {
      // Check if already exists
      const existing = await database.query<DNCListRow>(
        `SELECT * FROM dnc_list
        WHERE org_id = $1
          AND (($2::varchar IS NOT NULL AND phone = $2) OR ($3::varchar IS NOT NULL AND email = $3))
          AND channel = $4
        LIMIT 1`,
        [input.orgId, normalizedPhone, normalizedEmail, input.channel || 'all']
      )

      if (existing[0]) {
        // Update existing entry
        const results = await database.query<DNCListRow>(
          `UPDATE dnc_list
          SET source = COALESCE($2, source),
              reason = COALESCE($3, reason),
              added_by = COALESCE($4, added_by),
              expires_at = $5
          WHERE id = $1
          RETURNING *`,
          [existing[0].id, input.source || 'internal', input.reason, input.addedBy, expiresAt]
        )
        return this.transformEntry(results[0])
      }

      // Insert new entry
      const results = await database.query<DNCListRow>(
        `INSERT INTO dnc_list (org_id, phone, email, source, channel, reason, added_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          input.orgId,
          normalizedPhone,
          normalizedEmail,
          input.source || 'internal',
          input.channel || 'all',
          input.reason,
          input.addedBy,
          expiresAt
        ]
      )

      return this.transformEntry(results[0])
    } catch (error) {
      throw new DatabaseError(
        'Failed to add to suppression list',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Remove a phone number from the suppression list
   */
  async removeFromSuppressionList(
    orgId: string,
    identifier: string,
    channel?: DNCChannel
  ): Promise<boolean> {
    // Determine if identifier is phone or email
    const isEmail = identifier.includes('@')
    const normalized = isEmail ? this.normalizeEmail(identifier) : this.normalizePhone(identifier)

    try {
      let query = `DELETE FROM dnc_list WHERE org_id = $1`
      const values: unknown[] = [orgId]
      let paramCount = 2

      if (isEmail) {
        query += ` AND email = $${paramCount++}`
      } else {
        query += ` AND phone = $${paramCount++}`
      }
      values.push(normalized)

      if (channel) {
        query += ` AND channel = $${paramCount++}`
        values.push(channel)
      }

      const results = await database.query(query, values)
      return (results as { rowCount: number }).rowCount > 0
    } catch (error) {
      throw new DatabaseError(
        'Failed to remove from suppression list',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * List all suppression entries for an organization
   */
  async list(
    orgId: string,
    options: {
      source?: DNCSource
      channel?: DNCChannel
      includeExpired?: boolean
      page?: number
      limit?: number
    } = {}
  ): Promise<{
    entries: DNCEntry[]
    total: number
    page: number
    limit: number
  }> {
    const { page = 1, limit = 50, source, channel, includeExpired = false } = options

    const conditions: string[] = ['org_id = $1']
    const values: unknown[] = [orgId]
    let paramCount = 2

    if (source) {
      conditions.push(`source = $${paramCount++}`)
      values.push(source)
    }

    if (channel) {
      conditions.push(`channel = $${paramCount++}`)
      values.push(channel)
    }

    if (!includeExpired) {
      conditions.push(`(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const offset = (page - 1) * limit

    try {
      const results = await database.query<DNCListRow>(
        `SELECT * FROM dnc_list
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset]
      )

      const countResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM dnc_list ${whereClause}`,
        values
      )
      const total = parseInt(countResult[0]?.count || '0')

      return {
        entries: results.map(this.transformEntry),
        total,
        page,
        limit
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to list suppression entries',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Sync with FTC National DNC Registry
   * Requires an FTC subscription and download pipeline.
   */
  async syncFTCList(orgId: string): Promise<{
    status: 'success' | 'not_configured' | 'error'
    message: string
    recordsProcessed?: number
  }> {
    // In production, this would:
    // 1. Download the FTC DNC list (requires subscription)
    // 2. Parse the file (phone numbers in specific format)
    // 3. Upsert into dnc_list with source = 'federal_dnc'

    console.log(`[SuppressionService] FTC sync requested for org: ${orgId}`)

    return {
      status: 'not_configured',
      message:
        'FTC DNC Registry sync is not configured. Please contact support to set up your FTC subscription.'
    }
  }

  /**
   * Import suppression list from CSV/array
   */
  async bulkImport(
    orgId: string,
    entries: Array<{ phone?: string; email?: string; reason?: string }>,
    source: DNCSource = 'imported',
    addedBy?: string
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const entry of entries) {
      try {
        if (!entry.phone && !entry.email) {
          skipped++
          continue
        }

        await this.addToSuppressionList({
          orgId,
          phone: entry.phone,
          email: entry.email,
          source,
          reason: entry.reason,
          addedBy
        })
        imported++
      } catch (error) {
        errors.push(
          `Failed to import ${entry.phone || entry.email}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    return { imported, skipped, errors }
  }

  /**
   * Get statistics about suppression list
   */
  async getStats(orgId: string): Promise<{
    totalEntries: number
    bySource: Record<string, number>
    byChannel: Record<string, number>
    expiringInWeek: number
  }> {
    try {
      // Total active entries
      const totalResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM dnc_list
        WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [orgId]
      )

      // By source
      const bySourceResult = await database.query<{ source: string; count: string }>(
        `SELECT source, COUNT(*) as count FROM dnc_list
        WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        GROUP BY source`,
        [orgId]
      )

      // By channel
      const byChannelResult = await database.query<{ channel: string; count: string }>(
        `SELECT channel, COUNT(*) as count FROM dnc_list
        WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        GROUP BY channel`,
        [orgId]
      )

      // Expiring in next week
      const expiringResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM dnc_list
        WHERE org_id = $1
          AND expires_at IS NOT NULL
          AND expires_at > CURRENT_TIMESTAMP
          AND expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days'`,
        [orgId]
      )

      const bySource: Record<string, number> = {}
      for (const row of bySourceResult) {
        bySource[row.source] = parseInt(row.count)
      }

      const byChannel: Record<string, number> = {}
      for (const row of byChannelResult) {
        byChannel[row.channel] = parseInt(row.count)
      }

      return {
        totalEntries: parseInt(totalResult[0]?.count || '0'),
        bySource,
        byChannel,
        expiringInWeek: parseInt(expiringResult[0]?.count || '0')
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to get suppression stats',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Clean up expired entries
   */
  async cleanupExpired(orgId: string): Promise<number> {
    try {
      const results = await database.query(
        `DELETE FROM dnc_list
        WHERE org_id = $1 AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`,
        [orgId]
      )
      return (results as { rowCount: number }).rowCount
    } catch (error) {
      throw new DatabaseError(
        'Failed to cleanup expired entries',
        error instanceof Error ? error : undefined
      )
    }
  }
}

// Export singleton instance
export const suppressionService = new SuppressionService()
