/**
 * EnrichmentService
 *
 * Service layer for data enrichment in the UCC-MCA Intelligence Platform.
 * Enriches prospect data with growth signals, health scores, revenue estimates,
 * and industry classifications from external data sources.
 *
 * @module server/services/EnrichmentService
 */

import { database } from '../database/connection'
import type { ResolvedDataTier } from '../middleware/dataTier'
import { listEnabledIntegrations } from '../config/tieredIntegrations'

/**
 * Result of enriching a prospect with additional data.
 */
interface EnrichmentResult {
  /** Detected growth signals by type */
  growth_signals: {
    /** Number of hiring signals detected */
    hiring: number
    /** Number of permit applications detected */
    permits: number
    /** Number of new contracts detected */
    contracts: number
    /** Number of expansion signals detected */
    expansion: number
    /** Number of equipment purchase signals detected */
    equipment: number
  }
  /** Calculated health score */
  health_score: {
    /** Numeric score (0-100) */
    score: number
    /** Letter grade (A-F) */
    grade: string
    /** Trend direction (improving, stable, declining) */
    trend: string
    /** Number of violations found */
    violations: number
  }
  /** Estimated annual revenue */
  estimated_revenue: number
  /** Industry classification */
  industry_classification: string
  /** Data sources used for enrichment */
  data_sources_used: string[]
}

/**
 * Service for enriching prospect data with external signals.
 *
 * Provides methods for:
 * - Single prospect enrichment
 * - Batch enrichment
 * - Triggering refresh of stale data
 * - Enrichment status monitoring
 *
 * @example
 * ```typescript
 * const service = new EnrichmentService()
 *
 * // Enrich a single prospect
 * const result = await service.enrichProspect('prospect-id')
 *
 * // Batch enrich multiple prospects
 * const results = await service.enrichBatch(['id1', 'id2', 'id3'])
 *
 * // Trigger refresh of stale data
 * const refreshResult = await service.triggerRefresh()
 * ```
 */
export class EnrichmentService {
  /**
   * Enrich a single prospect with growth signals and health data.
   *
   * This method:
   * 1. Fetches the prospect from the database
   * 2. Gathers enrichment data from live providers
   * 3. Updates the prospect with enrichment metadata
   * 4. Stores growth signals and health scores
   *
   * @param prospectId - The prospect's unique identifier
   * @returns Enrichment result with all gathered data
   * @throws {Error} If the prospect is not found
   */
  async enrichProspect(
    prospectId: string,
    dataTier: ResolvedDataTier = 'free-tier'
  ): Promise<EnrichmentResult> {
    // Get prospect details
    const prospect = await database.query('SELECT * FROM prospects WHERE id = $1', [prospectId])

    if (prospect.length === 0) {
      throw new Error(`Prospect ${prospectId} not found`)
    }

    this.assertLiveEnrichmentAvailable(dataTier)
  }

  /**
   * Enrich multiple prospects in a batch operation.
   *
   * Processes each prospect individually, collecting successes and failures.
   * Errors for individual prospects don't stop the batch.
   *
   * @param prospectIds - Array of prospect IDs to enrich
   * @returns Array of results indicating success/failure for each prospect
   */
  async enrichBatch(
    prospectIds: string[],
    dataTier: ResolvedDataTier = 'free-tier'
  ): Promise<Array<{ prospect_id: string; success: boolean; error?: string }>> {
    const results = []

    for (const prospectId of prospectIds) {
      try {
        await this.enrichProspect(prospectId, dataTier)
        results.push({ prospect_id: prospectId, success: true })
      } catch (error) {
        results.push({
          prospect_id: prospectId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }

  /**
   * Trigger a refresh of stale or unenriched prospect data.
   *
   * By default, refreshes prospects that:
   * - Have never been enriched
   * - Were last enriched more than 7 days ago
   *
   * Limited to 100 prospects per call for performance.
   *
   * @param force - If true, refresh all prospects regardless of staleness
   * @returns Summary of refresh operation results
   */
  async triggerRefresh(force: boolean = false, dataTier: ResolvedDataTier = 'free-tier') {
    // Get prospects that need refreshing
    const query = force
      ? 'SELECT id FROM prospects'
      : `SELECT id FROM prospects
         WHERE last_enriched_at IS NULL
            OR last_enriched_at < NOW() - INTERVAL '7 days'
         LIMIT 100`

    const prospects = await database.query<{ id: string }>(query)

    const prospectIds = prospects.map((p) => p.id)
    const results = await this.enrichBatch(prospectIds, dataTier)

    return {
      queued: prospectIds.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length
    }
  }

  /**
   * Get the current status of enrichment across all prospects.
   *
   * @returns Statistics about enrichment coverage and quality
   */
  async getStatus() {
    const stats = await database.query(`
      SELECT
        COUNT(*) as total_prospects,
        COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL) as enriched_count,
        COUNT(*) FILTER (WHERE last_enriched_at IS NULL) as unenriched_count,
        COUNT(*) FILTER (WHERE last_enriched_at < NOW() - INTERVAL '7 days') as stale_count,
        COALESCE(AVG(enrichment_confidence), 0) as avg_confidence
      FROM prospects
    `)

    return (
      stats[0] || {
        total_prospects: 0,
        enriched_count: 0,
        unenriched_count: 0,
        stale_count: 0,
        avg_confidence: 0
      }
    )
  }

  /**
   * Get the current status of the enrichment job queue.
   *
   * Note: In Phase 3, this will integrate with BullMQ for real queue status.
   *
   * @returns Queue telemetry status
   */
  async getQueueStatus() {
    return {
      supported: false,
      reason: 'Enrichment queue telemetry is not wired yet.',
      waiting: null,
      active: null,
      completed: null,
      failed: null,
      delayed: null
    }
  }

  private assertLiveEnrichmentAvailable(dataTier: ResolvedDataTier): never {
    const enabledIntegrations = listEnabledIntegrations(dataTier)
    const configuredProviders =
      enabledIntegrations.length > 0 ? enabledIntegrations.join(', ') : 'none'

    throw new Error(
      `EnrichmentService is not wired to live providers yet for ${dataTier}. Configured integrations: ${configuredProviders}.`
    )
  }
}
