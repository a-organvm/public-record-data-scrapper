import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { getPendingMigrations, normalizeMigrationVersion } from '../../../scripts/migrate'

let tempDir: string | undefined

function makeMigrationsDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'limen-migrations-'))
  writeFileSync(join(tempDir, '001_initial_schema.sql'), 'SELECT 1;')
  writeFileSync(join(tempDir, '014_prospects_org_id_not_null.sql'), 'SELECT 14;')
  writeFileSync(join(tempDir, '014_down.sql'), 'SELECT -14;')
  writeFileSync(join(tempDir, '015_bounded_check_constraints.sql'), 'SELECT 15;')
  return tempDir
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('migration runner helpers', () => {
  it('normalizes historical integer versions to zero-padded migration prefixes', () => {
    expect(normalizeMigrationVersion(1)).toBe('001')
    expect(normalizeMigrationVersion('14')).toBe('014')
    expect(normalizeMigrationVersion('014')).toBe('014')
  })

  it('does not rerun already-applied migrations recorded without zero padding', () => {
    const migrationsDir = makeMigrationsDir()
    const applied = new Set(['1', '14'].map(normalizeMigrationVersion))

    const pending = getPendingMigrations(migrationsDir, applied)

    expect(pending.map((migration) => migration.version)).toEqual(['015'])
  })
})
