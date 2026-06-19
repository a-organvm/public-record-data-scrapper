import { database } from '../database/connection'
import { DatabaseError, ValidationError } from '../errors'

export type LeadExportFormat = 'json' | 'csv' | 'both'

export interface LeadExportParams {
  state?: string
  industry?: string
  status?: string
  minScore?: number
  maxScore?: number
  limit?: number
  offset?: number
}

export interface LeadExportFilters {
  state?: string
  industry?: string
  status?: string
  min_score: number
  max_score?: number
}

export interface LeadExportLead {
  prospect_id: string
  company_name: string
  state: string
  industry: string
  status: string
  mca_score: number
  score_grade: 'A' | 'B' | 'C' | 'D' | 'F'
  recommendation: 'high_priority' | 'moderate_priority' | 'low_priority' | 'pass'
  score_confidence: number
  estimated_revenue: number | null
  default_date: string | null
  days_since_default: number | null
  last_filing_date: string | null
  ucc_filing_count: number
  active_ucc_count: number
  terminated_ucc_count: number
  lapsed_ucc_count: number
  secured_parties: string[]
  narrative: string
}

export interface LeadExportBatch {
  batch: {
    id: string
    generated_at: string
    filters: LeadExportFilters
    limit: number
    offset: number
    count: number
    total: number
    next_offset: number | null
  }
  leads: LeadExportLead[]
}

interface LeadExportDbRow {
  id: string
  company_name: string
  state: string
  industry: string
  status: string
  priority_score: number | string
  default_date: Date | string | null
  time_since_default: number | string | null
  last_filing_date: Date | string | null
  estimated_revenue: number | string | null
  narrative: string | null
  enrichment_confidence: number | string | null
  filing_count: number | string
  active_ucc_count: number | string
  terminated_ucc_count: number | string
  lapsed_ucc_count: number | string
  latest_ucc_filing_date: Date | string | null
  secured_parties: string[] | null
}

interface NormalizedLeadExportParams extends LeadExportParams {
  minScore: number
  limit: number
  offset: number
}

const DEFAULT_MIN_SCORE = 70
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

const CSV_HEADERS: Array<keyof LeadExportLead> = [
  'prospect_id',
  'company_name',
  'state',
  'industry',
  'status',
  'mca_score',
  'score_grade',
  'recommendation',
  'score_confidence',
  'estimated_revenue',
  'default_date',
  'days_since_default',
  'last_filing_date',
  'ucc_filing_count',
  'active_ucc_count',
  'terminated_ucc_count',
  'lapsed_ucc_count',
  'secured_parties',
  'narrative'
]

function coerceNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function coerceInteger(value: number | string | null | undefined, fallback = 0): number {
  const parsed = coerceNumber(value)
  return parsed === null ? fallback : Math.round(parsed)
}

function toDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return String(value).slice(0, 10)
}

function scoreGrade(score: number): LeadExportLead['score_grade'] {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

function recommendation(score: number): LeadExportLead['recommendation'] {
  if (score >= 75) return 'high_priority'
  if (score >= 55) return 'moderate_priority'
  if (score >= 40) return 'low_priority'
  return 'pass'
}

function calculateConfidence(row: LeadExportDbRow): number {
  const persistedConfidence = coerceNumber(row.enrichment_confidence)
  if (persistedConfidence !== null) {
    return Math.min(100, Math.max(0, Math.round(persistedConfidence * 100)))
  }

  let confidence = 50
  if (coerceInteger(row.filing_count) > 0) confidence += 25
  if (row.latest_ucc_filing_date || row.last_filing_date) confidence += 10
  if (row.narrative) confidence += 10
  if (row.estimated_revenue !== null) confidence += 5
  return Math.min(100, confidence)
}

function normalizeParams(params: LeadExportParams): NormalizedLeadExportParams {
  const minScore = params.minScore ?? DEFAULT_MIN_SCORE
  const maxScore = params.maxScore
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(params.offset ?? 0, 0)

  if (minScore < 0 || minScore > 100) {
    throw new ValidationError('minScore must be between 0 and 100')
  }

  if (maxScore !== undefined && (maxScore < 0 || maxScore > 100)) {
    throw new ValidationError('maxScore must be between 0 and 100')
  }

  if (maxScore !== undefined && maxScore < minScore) {
    throw new ValidationError('maxScore must be greater than or equal to minScore')
  }

  return {
    ...params,
    minScore,
    maxScore,
    limit,
    offset
  }
}

function buildWhereClause(params: NormalizedLeadExportParams): {
  whereClause: string
  values: unknown[]
} {
  const conditions = ['p.priority_score >= $1']
  const values: unknown[] = [params.minScore]
  let paramCount = 2

  if (params.maxScore !== undefined) {
    conditions.push(`p.priority_score <= $${paramCount++}`)
    values.push(params.maxScore)
  }

  if (params.state) {
    conditions.push(`p.state = $${paramCount++}`)
    values.push(params.state)
  }

  if (params.industry) {
    conditions.push(`p.industry = $${paramCount++}`)
    values.push(params.industry)
  }

  if (params.status) {
    conditions.push(`p.status = $${paramCount++}`)
    values.push(params.status)
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    values
  }
}

function mapLead(row: LeadExportDbRow): LeadExportLead {
  const score = coerceInteger(row.priority_score)
  const lastFilingDate =
    toDateString(row.latest_ucc_filing_date) ?? toDateString(row.last_filing_date)

  return {
    prospect_id: row.id,
    company_name: row.company_name,
    state: row.state,
    industry: row.industry,
    status: row.status,
    mca_score: score,
    score_grade: scoreGrade(score),
    recommendation: recommendation(score),
    score_confidence: calculateConfidence(row),
    estimated_revenue: coerceNumber(row.estimated_revenue),
    default_date: toDateString(row.default_date),
    days_since_default: coerceNumber(row.time_since_default),
    last_filing_date: lastFilingDate,
    ucc_filing_count: coerceInteger(row.filing_count),
    active_ucc_count: coerceInteger(row.active_ucc_count),
    terminated_ucc_count: coerceInteger(row.terminated_ucc_count),
    lapsed_ucc_count: coerceInteger(row.lapsed_ucc_count),
    secured_parties: row.secured_parties ?? [],
    narrative: row.narrative ?? ''
  }
}

function escapeCsv(value: unknown): string {
  const normalized = Array.isArray(value) ? value.join('; ') : value
  const text = String(normalized ?? '')
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function serializeLeadExportCsv(batch: LeadExportBatch): string {
  const rows = batch.leads.map((lead) =>
    CSV_HEADERS.map((header) => escapeCsv(lead[header])).join(',')
  )
  return [CSV_HEADERS.join(','), ...rows].join('\n')
}

export class LeadExportService {
  async exportLeads(params: LeadExportParams = {}): Promise<LeadExportBatch> {
    const normalized = normalizeParams(params)
    const { whereClause, values } = buildWhereClause(normalized)

    try {
      const countRows = await database.query<{ count: number | string }>(
        `SELECT COUNT(*)::integer AS count
         FROM prospects p
         ${whereClause}`,
        values
      )

      const total = coerceInteger(countRows[0]?.count)
      const limitParam = values.length + 1
      const offsetParam = values.length + 2
      const rows = await database.query<LeadExportDbRow>(
        `SELECT
           p.id,
           p.company_name,
           p.state,
           p.industry,
           p.status,
           p.priority_score,
           p.default_date,
           p.time_since_default,
           p.last_filing_date,
           p.estimated_revenue,
           p.narrative,
           p.enrichment_confidence,
           COUNT(uf.id)::integer AS filing_count,
           (COUNT(uf.id) FILTER (WHERE uf.status = 'active'))::integer AS active_ucc_count,
           (COUNT(uf.id) FILTER (WHERE uf.status = 'terminated'))::integer AS terminated_ucc_count,
           (COUNT(uf.id) FILTER (WHERE uf.status = 'lapsed'))::integer AS lapsed_ucc_count,
           MAX(uf.filing_date) AS latest_ucc_filing_date,
           COALESCE(
             ARRAY_AGG(DISTINCT uf.secured_party) FILTER (WHERE uf.secured_party IS NOT NULL),
             ARRAY[]::text[]
           ) AS secured_parties
         FROM prospects p
         LEFT JOIN prospect_ucc_filings puf ON p.id = puf.prospect_id
         LEFT JOIN ucc_filings uf ON puf.ucc_filing_id = uf.id
         ${whereClause}
         GROUP BY
           p.id,
           p.company_name,
           p.state,
           p.industry,
           p.status,
           p.priority_score,
           p.default_date,
           p.time_since_default,
           p.last_filing_date,
           p.estimated_revenue,
           p.narrative,
           p.enrichment_confidence
         ORDER BY p.priority_score DESC, MAX(uf.filing_date) DESC NULLS LAST, p.company_name ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...values, normalized.limit, normalized.offset]
      )

      const generatedAt = new Date().toISOString()
      const count = rows.length
      const nextOffset = normalized.offset + count < total ? normalized.offset + count : null

      return {
        batch: {
          id: `lead-export-${generatedAt.replace(/[:.]/g, '-')}`,
          generated_at: generatedAt,
          filters: {
            state: normalized.state,
            industry: normalized.industry,
            status: normalized.status,
            min_score: normalized.minScore ?? DEFAULT_MIN_SCORE,
            max_score: normalized.maxScore
          },
          limit: normalized.limit,
          offset: normalized.offset,
          count,
          total,
          next_offset: nextOffset
        },
        leads: rows.map(mapLead)
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error
      }
      throw new DatabaseError(
        'Failed to export scored MCA leads',
        error instanceof Error ? error : undefined
      )
    }
  }
}

export const leadExportService = new LeadExportService()
