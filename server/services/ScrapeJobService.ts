/**
 * ScrapeJobService
 *
 * Durable queue for async UCC scrape jobs. A customer POSTs a job, receives a
 * jobId immediately (202), then polls GET /api/scrape/jobs/:id for results.
 * Jobs persist across server restarts because status lives in the database.
 *
 * Lifecycle: queued → processing → completed | failed
 *
 * @module server/services/ScrapeJobService
 */

import { database } from '../database/connection'
import type { UCCSearchResponse } from './UCCSearchService'

export type ScrapeJobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface ScrapeJob {
  id: string
  orgId: string
  apiKeyId: string | null
  companyName: string
  state: string
  limit: number
  status: ScrapeJobStatus
  result: UCCSearchResponse | null
  error: string | null
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string
}

export interface EnqueueInput {
  orgId: string
  apiKeyId: string | null
  companyName: string
  state: string
  limit: number
}

interface ScrapeJobRow {
  id: string
  org_id: string
  api_key_id: string | null
  company_name: string
  state: string
  search_limit: number
  status: ScrapeJobStatus
  result: UCCSearchResponse | null
  error: string | null
  queued_at: string
  started_at: string | null
  completed_at: string | null
  expires_at: string
}

function toJob(row: ScrapeJobRow): ScrapeJob {
  return {
    id: row.id,
    orgId: row.org_id,
    apiKeyId: row.api_key_id,
    companyName: row.company_name,
    state: row.state,
    limit: row.search_limit,
    status: row.status,
    result: row.result,
    error: row.error,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  }
}

export class ScrapeJobService {
  async enqueue(input: EnqueueInput): Promise<ScrapeJob> {
    const rows = await database.query<ScrapeJobRow>(
      `INSERT INTO scrape_jobs (org_id, api_key_id, company_name, state, search_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.orgId, input.apiKeyId, input.companyName, input.state, input.limit]
    )
    if (!rows[0]) throw new Error('Failed to create scrape job')
    return toJob(rows[0])
  }

  /** Returns the job only if it belongs to the given org (tenant isolation). */
  async get(jobId: string, orgId: string): Promise<ScrapeJob | null> {
    const rows = await database.query<ScrapeJobRow>(
      `SELECT * FROM scrape_jobs WHERE id = $1 AND org_id = $2`,
      [jobId, orgId]
    )
    return rows[0] ? toJob(rows[0]) : null
  }

  async list(orgId: string, limit = 20): Promise<ScrapeJob[]> {
    const rows = await database.query<ScrapeJobRow>(
      `SELECT * FROM scrape_jobs WHERE org_id = $1
       ORDER BY queued_at DESC LIMIT $2`,
      [orgId, limit]
    )
    return rows.map(toJob)
  }

  async markProcessing(jobId: string): Promise<void> {
    await database.query(
      `UPDATE scrape_jobs SET status = 'processing', started_at = NOW()
       WHERE id = $1 AND status = 'queued'`,
      [jobId]
    )
  }

  async markCompleted(jobId: string, result: UCCSearchResponse): Promise<void> {
    await database.query(
      `UPDATE scrape_jobs
       SET status = 'completed', result = $2, completed_at = NOW()
       WHERE id = $1`,
      [jobId, JSON.stringify(result)]
    )
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await database.query(
      `UPDATE scrape_jobs
       SET status = 'failed', error = $2, completed_at = NOW()
       WHERE id = $1`,
      [jobId, error]
    )
  }

  /** Deletes jobs whose expires_at has passed. Safe to call periodically. */
  async cleanup(): Promise<number> {
    const rows = await database.query<{ count: string }>(
      `DELETE FROM scrape_jobs WHERE expires_at < NOW() RETURNING id`
    )
    return rows.length
  }
}
