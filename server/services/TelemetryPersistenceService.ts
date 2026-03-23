/**
 * TelemetryPersistenceService
 *
 * Persists and hydrates ingestion coverage telemetry to/from the database.
 * Handles the four telemetry tables: ingestion_telemetry, ingestion_successes,
 * ingestion_failures, and ingestion_fallbacks.
 *
 * @module server/services/TelemetryPersistenceService
 */

import type {
  IngestionCoverageTelemetry,
  IngestionSuccessRecord,
  IngestionFailureRecord,
  IngestionFallbackRecord,
  IngestionStrategy,
  IngestionCircuitState,
  IngestionQueueOrigin
} from '../queue/queues'

interface DbRow {
  [key: string]: unknown
}

interface TelemetryRow extends DbRow {
  state_code: string
  current_status: string
  last_job_id: string | null
  last_queued_at: string | null
  last_started_at: string | null
  last_successful_pull: string | null
  last_failed_at: string | null
  last_error: string | null
  last_records_processed: number | null
  data_tier: string | null
  ucc_provider: string | null
  queued_by: string | null
  current_strategy: string | null
  available_strategies: string[] | string | null
  circuit_state: string
  circuit_opened_at: string | null
  circuit_backoff_until: string | null
  circuit_trip_count: number
  escalation_count: number
  last_escalated_at: string | null
  last_escalation_reason: string | null
  success_count: number
  failure_count: number
  consecutive_failures: number
}

interface SuccessRow extends DbRow {
  completed_at: string
  records_processed: number
}

interface FailureRow extends DbRow {
  failed_at: string
  error: string
}

interface FallbackRow extends DbRow {
  escalated_at: string
  from_strategy: string | null
  to_strategy: string
  reason: string
  delay_ms: number
}

interface DeleteCountRow extends DbRow {
  deleted: number
}

type DbClient = {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

function parseAvailableStrategies(raw: string[] | string | null | undefined): IngestionStrategy[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as IngestionStrategy[]
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as IngestionStrategy[]) : []
  } catch {
    return []
  }
}

function rowToTelemetry(
  row: TelemetryRow,
  successes: IngestionSuccessRecord[],
  failures: IngestionFailureRecord[],
  fallbacks: IngestionFallbackRecord[]
): IngestionCoverageTelemetry {
  return {
    state: row.state_code,
    currentStatus: row.current_status as IngestionCoverageTelemetry['currentStatus'],
    lastJobId: row.last_job_id,
    lastQueuedAt: row.last_queued_at,
    lastStartedAt: row.last_started_at,
    lastSuccessfulPull: row.last_successful_pull,
    lastFailedAt: row.last_failed_at,
    lastError: row.last_error,
    lastRecordsProcessed: row.last_records_processed,
    dataTier: row.data_tier as IngestionCoverageTelemetry['dataTier'],
    uccProvider: row.ucc_provider as IngestionCoverageTelemetry['uccProvider'],
    queuedBy: row.queued_by as IngestionQueueOrigin | null,
    currentStrategy: row.current_strategy as IngestionStrategy | null,
    availableStrategies: parseAvailableStrategies(row.available_strategies),
    circuitState: row.circuit_state as IngestionCircuitState,
    circuitOpenedAt: row.circuit_opened_at,
    circuitBackoffUntil: row.circuit_backoff_until,
    circuitTripCount: row.circuit_trip_count ?? 0,
    escalationCount: row.escalation_count ?? 0,
    lastEscalatedAt: row.last_escalated_at,
    lastEscalationReason: row.last_escalation_reason,
    successCount: row.success_count ?? 0,
    failureCount: row.failure_count ?? 0,
    consecutiveFailures: row.consecutive_failures ?? 0,
    successes,
    failures,
    fallbacks
  }
}

export class TelemetryPersistenceService {
  constructor(private db: DbClient) {}

  /**
   * Upsert telemetry state for a single state code.
   * Maps camelCase JS fields to snake_case SQL columns.
   */
  async persistState(stateCode: string, telemetry: IngestionCoverageTelemetry): Promise<void> {
    const availableStrategiesJson = JSON.stringify(telemetry.availableStrategies)

    await this.db.query(
      `INSERT INTO ingestion_telemetry (
        state_code,
        current_status,
        last_job_id,
        last_queued_at,
        last_started_at,
        last_successful_pull,
        last_failed_at,
        last_error,
        last_records_processed,
        data_tier,
        ucc_provider,
        queued_by,
        current_strategy,
        available_strategies,
        circuit_state,
        circuit_opened_at,
        circuit_backoff_until,
        circuit_trip_count,
        escalation_count,
        last_escalated_at,
        last_escalation_reason,
        success_count,
        failure_count,
        consecutive_failures,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, NOW()
      )
      ON CONFLICT (state_code) DO UPDATE SET
        current_status = EXCLUDED.current_status,
        last_job_id = EXCLUDED.last_job_id,
        last_queued_at = EXCLUDED.last_queued_at,
        last_started_at = EXCLUDED.last_started_at,
        last_successful_pull = EXCLUDED.last_successful_pull,
        last_failed_at = EXCLUDED.last_failed_at,
        last_error = EXCLUDED.last_error,
        last_records_processed = EXCLUDED.last_records_processed,
        data_tier = EXCLUDED.data_tier,
        ucc_provider = EXCLUDED.ucc_provider,
        queued_by = EXCLUDED.queued_by,
        current_strategy = EXCLUDED.current_strategy,
        available_strategies = EXCLUDED.available_strategies,
        circuit_state = EXCLUDED.circuit_state,
        circuit_opened_at = EXCLUDED.circuit_opened_at,
        circuit_backoff_until = EXCLUDED.circuit_backoff_until,
        circuit_trip_count = EXCLUDED.circuit_trip_count,
        escalation_count = EXCLUDED.escalation_count,
        last_escalated_at = EXCLUDED.last_escalated_at,
        last_escalation_reason = EXCLUDED.last_escalation_reason,
        success_count = EXCLUDED.success_count,
        failure_count = EXCLUDED.failure_count,
        consecutive_failures = EXCLUDED.consecutive_failures,
        updated_at = NOW()`,
      [
        stateCode,
        telemetry.currentStatus,
        telemetry.lastJobId,
        telemetry.lastQueuedAt,
        telemetry.lastStartedAt,
        telemetry.lastSuccessfulPull,
        telemetry.lastFailedAt,
        telemetry.lastError,
        telemetry.lastRecordsProcessed,
        telemetry.dataTier,
        telemetry.uccProvider,
        telemetry.queuedBy,
        telemetry.currentStrategy,
        availableStrategiesJson,
        telemetry.circuitState,
        telemetry.circuitOpenedAt,
        telemetry.circuitBackoffUntil,
        telemetry.circuitTripCount,
        telemetry.escalationCount,
        telemetry.lastEscalatedAt,
        telemetry.lastEscalationReason,
        telemetry.successCount,
        telemetry.failureCount,
        telemetry.consecutiveFailures
      ]
    )
  }

  /**
   * Load all states from DB, joined with recent history (30 days).
   * Returns a Map keyed by state_code.
   */
  async hydrateAll(): Promise<Map<string, IngestionCoverageTelemetry>> {
    const rows = await this.db.query<TelemetryRow>(
      'SELECT * FROM ingestion_telemetry ORDER BY state_code'
    )

    const result = new Map<string, IngestionCoverageTelemetry>()

    if (rows.length === 0) {
      return result
    }

    const horizon = "NOW() - INTERVAL '30 days'"

    for (const row of rows) {
      const stateCode = row.state_code

      const [successes, failures, fallbacks] = await Promise.all([
        this.db.query<SuccessRow>(
          `SELECT completed_at, records_processed
           FROM ingestion_successes
           WHERE state_code = $1 AND completed_at >= ${horizon}
           ORDER BY completed_at DESC`,
          [stateCode]
        ),
        this.db.query<FailureRow>(
          `SELECT failed_at, error
           FROM ingestion_failures
           WHERE state_code = $1 AND failed_at >= ${horizon}
           ORDER BY failed_at DESC`,
          [stateCode]
        ),
        this.db.query<FallbackRow>(
          `SELECT escalated_at, from_strategy, to_strategy, reason, delay_ms
           FROM ingestion_fallbacks
           WHERE state_code = $1 AND escalated_at >= ${horizon}
           ORDER BY escalated_at DESC`,
          [stateCode]
        )
      ])

      const successRecords: IngestionSuccessRecord[] = successes.map((s) => ({
        completedAt: s.completed_at,
        recordsProcessed: s.records_processed
      }))

      const failureRecords: IngestionFailureRecord[] = failures.map((f) => ({
        failedAt: f.failed_at,
        error: f.error
      }))

      const fallbackRecords: IngestionFallbackRecord[] = fallbacks.map((fb) => ({
        escalatedAt: fb.escalated_at,
        fromStrategy: fb.from_strategy as IngestionStrategy | null,
        toStrategy: fb.to_strategy as IngestionStrategy,
        reason: fb.reason,
        delayMs: fb.delay_ms
      }))

      result.set(stateCode, rowToTelemetry(row, successRecords, failureRecords, fallbackRecords))
    }

    return result
  }

  /**
   * Record a successful ingestion into ingestion_successes.
   */
  async recordSuccess(
    stateCode: string,
    completedAt: string,
    recordsProcessed: number,
    strategy?: string,
    durationMs?: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO ingestion_successes (id, state_code, completed_at, records_processed, strategy, duration_ms)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [stateCode, completedAt, recordsProcessed, strategy ?? null, durationMs ?? null]
    )
  }

  /**
   * Record a failed ingestion into ingestion_failures.
   */
  async recordFailure(
    stateCode: string,
    failedAt: string,
    error: string,
    strategy?: string
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO ingestion_failures (id, state_code, failed_at, error, strategy)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [stateCode, failedAt, error, strategy ?? null]
    )
  }

  /**
   * Record a fallback escalation into ingestion_fallbacks.
   */
  async recordFallback(
    stateCode: string,
    escalatedAt: string,
    fromStrategy: string | null,
    toStrategy: string,
    reason: string,
    delayMs?: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO ingestion_fallbacks (id, state_code, escalated_at, from_strategy, to_strategy, reason, delay_ms)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
      [stateCode, escalatedAt, fromStrategy, toStrategy, reason, delayMs ?? 0]
    )
  }

  /**
   * Delete records older than retentionDays from all history tables.
   * Returns total deleted count across all three tables.
   */
  async pruneHistory(retentionDays = 30): Promise<{ deleted: number }> {
    const interval = `${retentionDays} days`

    const [successResult, failureResult, fallbackResult] = await Promise.all([
      this.db.query<DeleteCountRow>(
        `WITH deleted AS (
           DELETE FROM ingestion_successes
           WHERE completed_at < NOW() - $1::interval
           RETURNING 1
         )
         SELECT COUNT(*)::int AS deleted FROM deleted`,
        [interval]
      ),
      this.db.query<DeleteCountRow>(
        `WITH deleted AS (
           DELETE FROM ingestion_failures
           WHERE failed_at < NOW() - $1::interval
           RETURNING 1
         )
         SELECT COUNT(*)::int AS deleted FROM deleted`,
        [interval]
      ),
      this.db.query<DeleteCountRow>(
        `WITH deleted AS (
           DELETE FROM ingestion_fallbacks
           WHERE escalated_at < NOW() - $1::interval
           RETURNING 1
         )
         SELECT COUNT(*)::int AS deleted FROM deleted`,
        [interval]
      )
    ])

    const total =
      (successResult[0]?.deleted ?? 0) +
      (failureResult[0]?.deleted ?? 0) +
      (fallbackResult[0]?.deleted ?? 0)

    return { deleted: total }
  }
}
