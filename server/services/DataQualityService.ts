import {
  STATE_VOLUME_EXPECTATIONS,
  DEFAULT_VOLUME_EXPECTATION,
  FIELD_COMPLETENESS_THRESHOLD,
  PARTY_NAME_THRESHOLD,
  MAX_DEDUPLICATION_RATE,
  RECENCY_WINDOW_DAYS
} from '../config/dataQuality'

export interface DataQualityReport {
  stateCode: string
  jobId: string
  timestamp: string
  recordsIngested: number
  assertions: {
    volumeInRange: boolean
    expectedVolumeRange: [number, number]
    fieldCompleteness: number
    deduplicationRate: number
    filingDateRecency: boolean
    partyNamePresent: number
  }
  passed: boolean
  warnings: string[]
}

export class DataQualityService {
  constructor(private db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }) {}

  // Pure validation — does NOT touch the database
  validateBatch(
    stateCode: string,
    jobId: string,
    filings: {
      filingNumber?: string
      filingDate?: string
      debtor?: { name?: string }
      securedParty?: { name?: string }
    }[]
  ): DataQualityReport {
    const expectation =
      STATE_VOLUME_EXPECTATIONS[stateCode.toUpperCase()] ?? DEFAULT_VOLUME_EXPECTATION
    const warnings: string[] = []
    const count = filings.length

    // Volume check
    const volumeInRange = count >= expectation.min && count <= expectation.max
    if (!volumeInRange) {
      warnings.push(
        `Volume ${count} outside expected range [${expectation.min}, ${expectation.max}]`
      )
    }

    // Field completeness: % of records with filingNumber AND filingDate
    const completeCount = filings.filter((f) => f.filingNumber && f.filingDate).length
    const fieldCompleteness = count > 0 ? completeCount / count : 0

    if (fieldCompleteness < FIELD_COMPLETENESS_THRESHOLD) {
      warnings.push(
        `Field completeness ${(fieldCompleteness * 100).toFixed(1)}% below ${FIELD_COMPLETENESS_THRESHOLD * 100}% threshold`
      )
    }

    // Deduplication: % of duplicate filingNumbers
    const uniqueNumbers = new Set(filings.map((f) => f.filingNumber).filter(Boolean))
    const totalWithNumbers = filings.filter((f) => f.filingNumber).length
    const deduplicationRate = totalWithNumbers > 0 ? 1 - uniqueNumbers.size / totalWithNumbers : 0

    if (deduplicationRate > MAX_DEDUPLICATION_RATE) {
      warnings.push(
        `Deduplication rate ${(deduplicationRate * 100).toFixed(1)}% exceeds ${MAX_DEDUPLICATION_RATE * 100}% threshold`
      )
    }

    // Recency: at least one filing in the last RECENCY_WINDOW_DAYS
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RECENCY_WINDOW_DAYS)
    const filingDateRecency = filings.some((f) => {
      if (!f.filingDate) return false
      return new Date(f.filingDate) >= cutoff
    })

    if (!filingDateRecency && count > 0) {
      warnings.push(`No filings found within the last ${RECENCY_WINDOW_DAYS} days`)
    }

    // Party names: % with both debtor and secured party
    const partyCount = filings.filter((f) => f.debtor?.name && f.securedParty?.name).length
    const partyNamePresent = count > 0 ? partyCount / count : 0

    if (partyNamePresent < PARTY_NAME_THRESHOLD) {
      warnings.push(
        `Party name presence ${(partyNamePresent * 100).toFixed(1)}% below ${PARTY_NAME_THRESHOLD * 100}% threshold`
      )
    }

    const passed =
      volumeInRange &&
      fieldCompleteness >= FIELD_COMPLETENESS_THRESHOLD &&
      deduplicationRate <= MAX_DEDUPLICATION_RATE &&
      partyNamePresent >= PARTY_NAME_THRESHOLD

    return {
      stateCode: stateCode.toUpperCase(),
      jobId,
      timestamp: new Date().toISOString(),
      recordsIngested: count,
      assertions: {
        volumeInRange,
        expectedVolumeRange: [expectation.min, expectation.max],
        fieldCompleteness: Number(fieldCompleteness.toFixed(4)),
        deduplicationRate: Number(deduplicationRate.toFixed(4)),
        filingDateRecency,
        partyNamePresent: Number(partyNamePresent.toFixed(4))
      },
      passed,
      warnings
    }
  }

  // Persist report to database
  async persistReport(report: DataQualityReport): Promise<void> {
    await this.db.query(
      `INSERT INTO data_quality_reports (state_code, job_id, records_ingested, volume_in_range, field_completeness, deduplication_rate, filing_date_recency, party_name_present, passed, warnings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        report.stateCode,
        report.jobId,
        report.recordsIngested,
        report.assertions.volumeInRange,
        report.assertions.fieldCompleteness,
        report.assertions.deduplicationRate,
        report.assertions.filingDateRecency,
        report.assertions.partyNamePresent,
        report.passed,
        report.warnings
      ]
    )
  }
}
