import { beforeAll, afterAll, afterEach } from 'vitest'
import { database } from '../database/connection'

// Track whether the database connection is available so that cleanup hooks
// can skip gracefully when running against a mocked DB (unit tests).
let dbAvailable = false

// Test database setup
beforeAll(async () => {
  // Connect to test database
  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL

  if (!testDbUrl) {
    // No database URL set — tests that need a real DB will use their own mocks.
    // This allows pure unit tests to run without a live Postgres instance.
    console.warn('No TEST_DATABASE_URL / DATABASE_URL set — skipping DB setup (unit-test mode)')
    return
  }

  try {
    await database.connect()
    dbAvailable = true
    console.log('✓ Test database connected')
  } catch (error) {
    console.error('Failed to connect to test database:', error)
    // Do not re-throw: tests that mock the DB will still pass; integration
    // tests that need a real connection will fail on their own assertions.
  }
})

// Clean up after each test
afterEach(async () => {
  if (!dbAvailable) return

  // Clean up test data after each test
  // This ensures tests don't interfere with each other
  const tables = [
    'coverage_alerts',
    'data_quality_reports',
    'portal_probe_results',
    'ingestion_fallbacks',
    'ingestion_failures',
    'ingestion_successes',
    'audit_logs',
    'usage_tracking',
    'enrichment_logs',
    'ingestion_logs',
    'data_ingestion_logs',
    'portfolio_health_scores',
    'growth_signals',
    'health_scores',
    'prospect_ucc_filings',
    'prospects',
    'portfolio_companies',
    'competitors',
    'ucc_filings',
    'users',
    'data_sources',
    'competitor_market_positions',
    'filing_velocity_metrics',
    'filing_events',
    'ucc_amendments'
  ]

  for (const table of tables) {
    try {
      await database.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') {
        continue
      }
      console.error('Failed to clean up test data:', error)
    }
  }
})

// Tear down after all tests
afterAll(async () => {
  if (!dbAvailable) return

  try {
    await database.disconnect()
    console.log('✓ Test database disconnected')
  } catch (error) {
    console.error('Failed to disconnect from test database:', error)
  }
})
