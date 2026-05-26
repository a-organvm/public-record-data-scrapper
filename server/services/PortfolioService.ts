/**
 * PortfolioService
 *
 * Service layer for managing funded portfolio companies in the UCC-MCA Intelligence Platform.
 * Tracks health scores, funding history, and performance metrics for companies that have
 * received merchant cash advances.
 *
 * @module server/services/PortfolioService
 */

import { database } from '../database/connection'

/**
 * Allowlist of valid columns for sorting to prevent SQL injection.
 * Only these columns can be used in ORDER BY clauses.
 */
const ALLOWED_SORT_COLUMNS = [
  'company_name',
  'funded_date',
  'funded_amount',
  'current_health_score',
  'health_grade',
  'health_trend',
  'state',
  'industry',
  'days_since_funding'
] as const

type AllowedSortColumn = (typeof ALLOWED_SORT_COLUMNS)[number]

/**
 * Validates and sanitizes a sort column to prevent SQL injection.
 *
 * @param column - The requested sort column name
 * @returns A safe column name from the allowlist, defaults to 'current_health_score'
 */
function validateSortColumn(column: string): AllowedSortColumn {
  if (ALLOWED_SORT_COLUMNS.includes(column as AllowedSortColumn)) {
    return column as AllowedSortColumn
  }
  return 'current_health_score' // Safe default
}

/**
 * Portfolio company entity representing a funded merchant.
 */
interface PortfolioCompany {
  /** Unique identifier */
  id: string
  /** Company name */
  company_name: string
  /** Date the company was funded */
  funded_date: string
  /** Amount funded */
  funded_amount: number
  /** Current health score (0-100) */
  current_health_score: number
  /** Health grade (A-F) */
  health_grade: string
  /** Health trend direction */
  health_trend: string
  /** State where company is located */
  state: string
  /** Industry classification */
  industry: string
  /** Days since the company was funded */
  days_since_funding: number
}

/**
 * Parameters for listing portfolio companies with filtering and pagination.
 */
interface ListParams {
  /** Page number (1-indexed) */
  page: number
  /** Number of items per page */
  limit: number
  /** Filter by health grade (A, B, C, D, F) */
  health_grade?: string
  /** Column to sort by */
  sort_by: string
  /** Sort direction */
  sort_order: 'asc' | 'desc'
}

/**
 * Service for managing funded portfolio companies.
 *
 * Provides methods for:
 * - Listing portfolio companies with filtering
 * - Retrieving individual company details
 * - Tracking health score history
 * - Aggregate portfolio statistics
 *
 * @example
 * ```typescript
 * const service = new PortfolioService()
 *
 * // List companies with health grade filter
 * const result = await service.list({
 *   page: 1,
 *   limit: 20,
 *   health_grade: 'A',
 *   sort_by: 'current_health_score',
 *   sort_order: 'desc'
 * })
 *
 * // Get health history for a company
 * const history = await service.getHealthHistory('company-id')
 * ```
 */
export class PortfolioService {
  /**
   * List portfolio companies with filtering, sorting, and pagination.
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of portfolio companies with total count
   */
  async list(params: ListParams) {
    const { page, limit, health_grade, sort_by, sort_order } = params
    const offset = (page - 1) * limit
    const safeSortBy = validateSortColumn(sort_by)
    // days_since_funding is a computed alias; ORDER BY on the alias is fine,
    // but it is safe because safeSortBy is validated against the allowlist.
    const safeSortOrder = sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'

    // Build WHERE clause
    const conditions: string[] = []
    const values: (string | number)[] = []
    let paramCount = 1

    if (health_grade) {
      conditions.push(`health_grade = $${paramCount++}`)
      values.push(health_grade)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Query portfolio companies
    const query = `
      SELECT
        id,
        company_name,
        funded_date,
        funded_amount,
        current_health_score,
        health_grade,
        health_trend,
        state,
        industry,
        EXTRACT(DAY FROM NOW() - funded_date)::integer as days_since_funding
      FROM portfolio_companies
      ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `
    values.push(limit, offset)

    const companies = await database.query<PortfolioCompany>(query, values)

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM portfolio_companies ${whereClause}`
    const countResult = await database.query<{ count: string }>(countQuery, values.slice(0, -2))
    const total = parseInt(countResult[0]?.count || '0')

    return {
      companies,
      page,
      limit,
      total
    }
  }

  /**
   * Get a portfolio company by ID with full details.
   *
   * @param id - The company's unique identifier
   * @returns The portfolio company if found, null otherwise
   */
  async getById(id: string) {
    const query = `
      SELECT
        id,
        company_name,
        funded_date,
        funded_amount,
        current_health_score,
        health_grade,
        health_trend,
        state,
        industry,
        contact_email,
        contact_phone,
        notes,
        EXTRACT(DAY FROM NOW() - funded_date)::integer as days_since_funding,
        created_at,
        updated_at
      FROM portfolio_companies
      WHERE id = $1
    `

    const results = await database.query<PortfolioCompany>(query, [id])
    return results[0] || null
  }

  /**
   * Get health score history for a portfolio company.
   *
   * Returns the last 30 health score records, ordered by most recent first.
   * Useful for tracking health trends over time.
   *
   * @param id - The company's unique identifier
   * @returns Array of health score records
   */
  async getHealthHistory(id: string) {
    const query = `
      SELECT
        score,
        grade,
        trend,
        violations_count,
        sentiment_score,
        recorded_at
      FROM health_scores
      WHERE portfolio_company_id = $1
      ORDER BY recorded_at DESC
      LIMIT 30
    `

    const results = await database.query(query, [id])
    return results
  }

  /**
   * Get aggregate statistics for the entire portfolio.
   *
   * Calculates:
   * - Total companies and funding amount
   * - Average health score
   * - Distribution by health grade (A-F)
   * - Distribution by health trend
   *
   * @returns Portfolio-wide statistics
   */
  async getStats() {
    const query = `
      SELECT
        COUNT(*) as total_companies,
        COALESCE(SUM(funded_amount), 0) as total_funded,
        COALESCE(AVG(current_health_score), 0) as avg_health_score,
        COUNT(*) FILTER (WHERE health_grade = 'A') as grade_a_count,
        COUNT(*) FILTER (WHERE health_grade = 'B') as grade_b_count,
        COUNT(*) FILTER (WHERE health_grade = 'C') as grade_c_count,
        COUNT(*) FILTER (WHERE health_grade = 'D') as grade_d_count,
        COUNT(*) FILTER (WHERE health_grade = 'F') as grade_f_count,
        COUNT(*) FILTER (WHERE health_trend = 'improving') as improving_count,
        COUNT(*) FILTER (WHERE health_trend = 'stable') as stable_count,
        COUNT(*) FILTER (WHERE health_trend = 'declining') as declining_count
      FROM portfolio_companies
    `

    const results = await database.query(query)
    return (
      results[0] || {
        total_companies: 0,
        total_funded: 0,
        avg_health_score: 0,
        grade_a_count: 0,
        grade_b_count: 0,
        grade_c_count: 0,
        grade_d_count: 0,
        grade_f_count: 0,
        improving_count: 0,
        stable_count: 0,
        declining_count: 0
      }
    )
  }
}
