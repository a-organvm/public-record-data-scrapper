/**
 * DisclosureService
 *
 * Generates state-required disclosures for MCA deals. Supports:
 * - CA SB 1235 (California)
 * - NY CFDL (New York Commercial Financing Disclosure Law)
 *
 * Features:
 * - Generate disclosure documents with calculated values
 * - Track signature status
 * - Manage disclosure versions and supersession
 */

import { database } from '../database/connection'
import { NotFoundError, ValidationError, DatabaseError } from '../errors'
import { disclosureCalculator, DisclosureCalculation } from './DisclosureCalculator'
import { dealsService } from './DealsService'
import type {
  Disclosure,
  DisclosureRequirement,
  DisclosureStatus,
  Deal
} from '@public-records/core'
import crypto from 'crypto'

// Database row types
interface DisclosureRow {
  id: string
  org_id: string
  deal_id: string
  requirement_id?: string
  state: string
  regulation_name: string
  version: string
  funding_amount: number
  total_dollar_cost: number
  finance_charge?: number
  term_days?: number
  payment_frequency?: string
  payment_amount?: number
  number_of_payments?: number
  apr_equivalent?: number
  disclosure_data: Record<string, unknown>
  document_url?: string
  document_hash?: string
  signature_required: boolean
  signature_url?: string
  signature_id?: string
  signed_at?: string
  signed_by?: string
  signed_ip?: string
  signature_image_url?: string
  status: string
  sent_at?: string
  viewed_at?: string
  expires_at?: string
  generated_by?: string
  created_at: string
  updated_at: string
}

interface DisclosureRequirementRow {
  id: string
  state: string
  regulation_name: string
  effective_date: string
  expiry_date?: string
  required_fields: string[]
  calculation_rules: Record<string, unknown>
  template_url?: string
  notes?: string
  created_at: string
  updated_at: string
}

// Input for generating a disclosure
interface GenerateDisclosureInput {
  dealId: string
  orgId: string
  state: string
  generatedBy?: string
  signatureRequired?: boolean
  expiresInDays?: number
}

// Signature recording input
interface RecordSignatureInput {
  disclosureId: string
  signedBy: string
  signedIp?: string
  signatureImageUrl?: string
  signatureId?: string
}

export class DisclosureService {
  /**
   * Transform database row to Disclosure type
   */
  private transformDisclosure(row: DisclosureRow): Disclosure {
    return {
      id: row.id,
      orgId: row.org_id,
      dealId: row.deal_id,
      requirementId: row.requirement_id,
      state: row.state,
      regulationName: row.regulation_name,
      version: row.version,
      fundingAmount: Number(row.funding_amount),
      totalDollarCost: Number(row.total_dollar_cost),
      // Use == null (not falsy) so a legitimate stored 0 is preserved rather
      // than coerced to undefined.
      financeCharge: row.finance_charge == null ? undefined : Number(row.finance_charge),
      termDays: row.term_days,
      paymentFrequency: row.payment_frequency,
      paymentAmount: row.payment_amount == null ? undefined : Number(row.payment_amount),
      numberOfPayments: row.number_of_payments,
      aprEquivalent: row.apr_equivalent == null ? undefined : Number(row.apr_equivalent),
      disclosureData: row.disclosure_data,
      documentUrl: row.document_url,
      documentHash: row.document_hash,
      signatureRequired: row.signature_required,
      signatureUrl: row.signature_url,
      signatureId: row.signature_id,
      signedAt: row.signed_at,
      signedBy: row.signed_by,
      signedIp: row.signed_ip,
      signatureImageUrl: row.signature_image_url,
      status: row.status as DisclosureStatus,
      sentAt: row.sent_at,
      viewedAt: row.viewed_at,
      expiresAt: row.expires_at,
      generatedBy: row.generated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * Transform database row to DisclosureRequirement type
   */
  private transformRequirement(row: DisclosureRequirementRow): DisclosureRequirement {
    return {
      id: row.id,
      state: row.state,
      regulationName: row.regulation_name,
      effectiveDate: row.effective_date,
      expiryDate: row.expiry_date,
      requiredFields: row.required_fields,
      calculationRules: row.calculation_rules,
      templateUrl: row.template_url,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * Get disclosure requirements for a state
   */
  async getRequirements(state: string): Promise<DisclosureRequirement | null> {
    try {
      const results = await database.query<DisclosureRequirementRow>(
        `SELECT * FROM disclosure_requirements
        WHERE state = $1
          AND effective_date <= CURRENT_DATE
          AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
        ORDER BY effective_date DESC
        LIMIT 1`,
        [state.toUpperCase()]
      )
      return results[0] ? this.transformRequirement(results[0]) : null
    } catch (error) {
      throw new DatabaseError(
        'Failed to get disclosure requirements',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get all active disclosure requirements
   */
  async getAllRequirements(): Promise<DisclosureRequirement[]> {
    try {
      const results = await database.query<DisclosureRequirementRow>(
        `SELECT * FROM disclosure_requirements
        WHERE effective_date <= CURRENT_DATE
          AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
        ORDER BY state, effective_date DESC`
      )
      return results.map(this.transformRequirement)
    } catch (error) {
      throw new DatabaseError(
        'Failed to get disclosure requirements',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if a state requires disclosure
   */
  async requiresDisclosure(state: string): Promise<boolean> {
    const requirements = await this.getRequirements(state)
    return requirements !== null
  }

  /**
   * Generate a disclosure for a deal
   */
  async generate(input: GenerateDisclosureInput): Promise<Disclosure> {
    // Get the deal
    const deal = await dealsService.getByIdOrThrow(input.dealId, input.orgId)

    // Validate deal has required fields
    if (!deal.amountRequested || !deal.factorRate) {
      throw new ValidationError(
        'Deal must have amountRequested and factorRate to generate disclosure'
      )
    }

    // Get state requirements
    const requirements = await this.getRequirements(input.state)
    if (!requirements) {
      throw new ValidationError(`No disclosure requirements found for state: ${input.state}`)
    }

    // Calculate disclosure values
    const calculation = disclosureCalculator.calculateFromDeal(deal, input.state)

    // Supersede any existing pending disclosures for this deal
    await this.supersedeExisting(input.dealId)

    // Generate version number
    const version = await this.getNextVersion(input.dealId)

    // Set expiration (default 30 days)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 30))

    try {
      const results = await database.query<DisclosureRow>(
        `INSERT INTO disclosures (
          org_id, deal_id, requirement_id, state, regulation_name, version,
          funding_amount, total_dollar_cost, finance_charge, term_days,
          payment_frequency, payment_amount, number_of_payments, apr_equivalent,
          disclosure_data, signature_required, expires_at, generated_by, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *`,
        [
          input.orgId,
          input.dealId,
          requirements.id,
          input.state.toUpperCase(),
          requirements.regulationName,
          version,
          calculation.fundingAmount,
          calculation.totalDollarCost,
          calculation.financeCharge,
          calculation.termDays,
          calculation.paymentFrequency,
          calculation.paymentAmount,
          calculation.numberOfPayments,
          calculation.aprEquivalent,
          JSON.stringify(this.buildDisclosureData(deal, calculation, requirements)),
          input.signatureRequired ?? true,
          expiresAt.toISOString(),
          input.generatedBy,
          'generated'
        ]
      )

      return this.transformDisclosure(results[0])
    } catch (error) {
      throw new DatabaseError(
        'Failed to generate disclosure',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Build the complete disclosure data object
   */
  private buildDisclosureData(
    deal: Deal,
    calculation: DisclosureCalculation,
    requirements: DisclosureRequirement
  ): Record<string, unknown> {
    return {
      // Calculated values
      ...disclosureCalculator.formatForDisplay(calculation),

      // Deal details
      dealId: deal.id,
      dealNumber: deal.dealNumber,

      // Regulation info
      regulationName: requirements.regulationName,
      requiredFields: requirements.requiredFields,

      // Payment schedule summary
      paymentScheduleSummary: calculation.paymentSchedule.slice(0, 5).map((p) => ({
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate.toISOString().split('T')[0],
        paymentAmount: p.paymentAmount.toFixed(2)
      })),

      // Additional required fields
      prepaymentPolicy: calculation.prepaymentPolicy,
      collateral: 'Future receivables',
      totalFees: calculation.totalFees.toFixed(2),

      // Timestamps
      generatedAt: new Date().toISOString()
    }
  }

  /**
   * Get the next version number for a deal's disclosures
   */
  private async getNextVersion(dealId: string): Promise<string> {
    const results = await database.query<{ max_version: string }>(
      `SELECT MAX(version) as max_version FROM disclosures WHERE deal_id = $1`,
      [dealId]
    )

    const currentMax = results[0]?.max_version
    if (!currentMax) {
      return '1.0'
    }

    const [major, minor] = currentMax.split('.').map(Number)
    return `${major}.${minor + 1}`
  }

  /**
   * Supersede existing pending disclosures for a deal
   */
  private async supersedeExisting(dealId: string): Promise<void> {
    await database.query(
      `UPDATE disclosures
      SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
      WHERE deal_id = $1 AND status NOT IN ('signed', 'expired', 'superseded')`,
      [dealId]
    )
  }

  /**
   * Get a disclosure by ID
   */
  async getById(id: string, orgId: string): Promise<Disclosure | null> {
    try {
      const results = await database.query<DisclosureRow>(
        'SELECT * FROM disclosures WHERE id = $1 AND org_id = $2',
        [id, orgId]
      )
      return results[0] ? this.transformDisclosure(results[0]) : null
    } catch (error) {
      throw new DatabaseError(
        'Failed to get disclosure',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get disclosure by ID, throwing if not found
   */
  async getByIdOrThrow(id: string, orgId: string): Promise<Disclosure> {
    const disclosure = await this.getById(id, orgId)
    if (!disclosure) {
      throw new NotFoundError('Disclosure', id)
    }
    return disclosure
  }

  /**
   * Get all disclosures for a deal
   */
  async getByDealId(dealId: string): Promise<Disclosure[]> {
    try {
      const results = await database.query<DisclosureRow>(
        'SELECT * FROM disclosures WHERE deal_id = $1 ORDER BY created_at DESC',
        [dealId]
      )
      return results.map(this.transformDisclosure)
    } catch (error) {
      throw new DatabaseError(
        'Failed to get disclosures for deal',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get the current active disclosure for a deal
   */
  async getCurrentDisclosure(dealId: string): Promise<Disclosure | null> {
    try {
      const results = await database.query<DisclosureRow>(
        `SELECT * FROM disclosures
        WHERE deal_id = $1 AND status NOT IN ('superseded', 'expired')
        ORDER BY created_at DESC
        LIMIT 1`,
        [dealId]
      )
      return results[0] ? this.transformDisclosure(results[0]) : null
    } catch (error) {
      throw new DatabaseError(
        'Failed to get current disclosure',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Record that disclosure was sent to merchant
   */
  async markAsSent(id: string, orgId: string): Promise<Disclosure> {
    try {
      const results = await database.query<DisclosureRow>(
        `UPDATE disclosures
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
        [id, orgId]
      )

      if (!results[0]) {
        throw new NotFoundError('Disclosure', id)
      }

      return this.transformDisclosure(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to mark disclosure as sent',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Record that disclosure was viewed by merchant
   */
  async markAsViewed(id: string): Promise<Disclosure> {
    try {
      const results = await database.query<DisclosureRow>(
        `UPDATE disclosures
        SET status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
            viewed_at = COALESCE(viewed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
        [id]
      )

      if (!results[0]) {
        throw new NotFoundError('Disclosure', id)
      }

      return this.transformDisclosure(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to mark disclosure as viewed',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Record signature on disclosure
   */
  async recordSignature(input: RecordSignatureInput): Promise<Disclosure> {
    const disclosure = await this.getById(input.disclosureId, '')
    if (!disclosure) {
      throw new NotFoundError('Disclosure', input.disclosureId)
    }

    // Validate disclosure is in signable state
    if (['signed', 'expired', 'superseded'].includes(disclosure.status)) {
      throw new ValidationError(`Disclosure cannot be signed in status: ${disclosure.status}`)
    }

    // Check expiration
    if (disclosure.expiresAt && new Date(disclosure.expiresAt) < new Date()) {
      await this.markAsExpired(input.disclosureId)
      throw new ValidationError('Disclosure has expired')
    }

    try {
      const results = await database.query<DisclosureRow>(
        `UPDATE disclosures
        SET status = 'signed',
            signed_at = CURRENT_TIMESTAMP,
            signed_by = $2,
            signed_ip = $3::inet,
            signature_image_url = $4,
            signature_id = $5,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
        [
          input.disclosureId,
          input.signedBy,
          input.signedIp || null,
          input.signatureImageUrl,
          input.signatureId
        ]
      )

      if (!results[0]) {
        throw new NotFoundError('Disclosure', input.disclosureId)
      }

      return this.transformDisclosure(results[0])
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error
      throw new DatabaseError(
        'Failed to record signature',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Mark disclosure as expired
   */
  private async markAsExpired(id: string): Promise<void> {
    await database.query(
      `UPDATE disclosures
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
      [id]
    )
  }

  /**
   * Set document URL and hash after PDF generation
   */
  async setDocumentUrl(
    id: string,
    orgId: string,
    documentUrl: string,
    documentContent?: Buffer
  ): Promise<Disclosure> {
    // Calculate hash if content provided
    const documentHash = documentContent
      ? crypto.createHash('sha256').update(documentContent).digest('hex')
      : null

    try {
      const results = await database.query<DisclosureRow>(
        `UPDATE disclosures
        SET document_url = $3,
            document_hash = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
        [id, orgId, documentUrl, documentHash]
      )

      if (!results[0]) {
        throw new NotFoundError('Disclosure', id)
      }

      return this.transformDisclosure(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to set document URL',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Set signature service URL (e.g., DocuSign, HelloSign)
   */
  async setSignatureUrl(
    id: string,
    orgId: string,
    signatureUrl: string,
    signatureId?: string
  ): Promise<Disclosure> {
    try {
      const results = await database.query<DisclosureRow>(
        `UPDATE disclosures
        SET signature_url = $3,
            signature_id = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND org_id = $2
        RETURNING *`,
        [id, orgId, signatureUrl, signatureId]
      )

      if (!results[0]) {
        throw new NotFoundError('Disclosure', id)
      }

      return this.transformDisclosure(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to set signature URL',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * List disclosures for an organization with filtering
   */
  async list(
    orgId: string,
    options: {
      status?: DisclosureStatus
      state?: string
      startDate?: Date
      endDate?: Date
      page?: number
      limit?: number
    } = {}
  ): Promise<{
    disclosures: Disclosure[]
    total: number
    page: number
    limit: number
  }> {
    const { page = 1, limit = 20, status, state, startDate, endDate } = options

    const conditions: string[] = ['org_id = $1']
    const values: unknown[] = [orgId]
    let paramCount = 2

    if (status) {
      conditions.push(`status = $${paramCount++}`)
      values.push(status)
    }

    if (state) {
      conditions.push(`state = $${paramCount++}`)
      values.push(state.toUpperCase())
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramCount++}`)
      values.push(startDate.toISOString())
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramCount++}`)
      values.push(endDate.toISOString())
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const offset = (page - 1) * limit

    try {
      const results = await database.query<DisclosureRow>(
        `SELECT * FROM disclosures
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset]
      )

      const countResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM disclosures ${whereClause}`,
        values
      )
      const total = parseInt(countResult[0]?.count || '0')

      return {
        disclosures: results.map(this.transformDisclosure),
        total,
        page,
        limit
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to list disclosures',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if deal has a signed disclosure (for deal pipeline gates)
   */
  async hasSigned(dealId: string): Promise<boolean> {
    const results = await database.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM disclosures
      WHERE deal_id = $1 AND status = 'signed'`,
      [dealId]
    )
    return parseInt(results[0]?.count || '0') > 0
  }

  /**
   * Get pending disclosures (sent but not signed) for follow-up
   */
  async getPendingForFollowUp(orgId: string, daysOld: number = 3): Promise<Disclosure[]> {
    try {
      const results = await database.query<DisclosureRow>(
        `SELECT * FROM disclosures
        WHERE org_id = $1
          AND status IN ('sent', 'viewed')
          AND sent_at < NOW() - ($2 || ' days')::interval
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY sent_at ASC`,
        [orgId, daysOld.toString()]
      )
      return results.map(this.transformDisclosure)
    } catch (error) {
      throw new DatabaseError(
        'Failed to get pending disclosures',
        error instanceof Error ? error : undefined
      )
    }
  }
}

// Export singleton instance
export const disclosureService = new DisclosureService()
