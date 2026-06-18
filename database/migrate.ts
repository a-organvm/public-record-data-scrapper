import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface Migration {
  // Canonical migration version is the zero-padded numeric prefix as a string
  // (e.g. '001'), matching the schema_migrations.version VARCHAR(50) column
  // defined in migrations/001_initial_schema.sql and database/schema.sql.
  version: string
  name: string
  sql: string
}

function normalizeMigrationVersion(version: unknown): string {
  const raw = String(version).trim()
  if (/^\d+$/.test(raw)) {
    return raw.padStart(3, '0')
  }
  return raw
}

class MigrationRunner {
  private client: Client

  constructor(connectionString: string) {
    this.client = new Client({ connectionString })
  }

  async connect(): Promise<void> {
    await this.client.connect()
    await this.createMigrationsTable()
  }

  async disconnect(): Promise<void> {
    await this.client.end()
  }

  private async createMigrationsTable(): Promise<void> {
    // Must match migrations/001_initial_schema.sql and database/schema.sql:
    // version is VARCHAR (zero-padded prefix), with name + applied_at.
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
  }

  async getAppliedMigrations(): Promise<string[]> {
    // Sort numerically by the version prefix so ordering is correct even though
    // version is stored as text ('001', '002', ... '010', ...).
    const result = await this.client.query(
      'SELECT version FROM schema_migrations ORDER BY (version)::int'
    )
    return result.rows.map((row) => normalizeMigrationVersion(row.version))
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const appliedVersions = await this.getAppliedMigrations()
    const allMigrations = this.loadMigrations()

    return allMigrations.filter((m) => !appliedVersions.includes(m.version))
  }

  private loadMigrations(): Migration[] {
    const migrationsDir = path.join(__dirname, 'migrations')

    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found')
      return []
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    return files.map((file) => {
      const match = file.match(/^(\d+)_(.+)\.sql$/)
      if (!match) {
        throw new Error(`Invalid migration filename: ${file}`)
      }

      // Preserve the zero-padded numeric prefix as the canonical string version.
      const version = match[1]
      const name = match[2]
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')

      return { version, name, sql }
    })
  }

  async runMigrations(): Promise<void> {
    const pending = await this.getPendingMigrations()

    if (pending.length === 0) {
      console.log('✓ No pending migrations')
      return
    }

    console.log(`Found ${pending.length} pending migration(s)\n`)

    for (const migration of pending) {
      console.log(`Applying migration ${migration.version}: ${migration.name}`)

      try {
        await this.client.query('BEGIN')
        await this.client.query(migration.sql)
        // ON CONFLICT DO NOTHING: some migrations self-record their version
        // (e.g. 001_initial_schema.sql), so avoid a duplicate-key error.
        await this.client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [migration.version, migration.name]
        )
        await this.client.query('COMMIT')

        console.log(`✓ Migration ${migration.version} applied successfully\n`)
      } catch (error) {
        await this.client.query('ROLLBACK')
        console.error(`✗ Migration ${migration.version} failed:`, error)
        throw error
      }
    }

    console.log(`✓ All migrations applied successfully`)
  }

  async rollback(steps = 1): Promise<void> {
    const applied = await this.getAppliedMigrations()

    if (applied.length === 0) {
      console.log('No migrations to rollback')
      return
    }

    const toRollback = applied.slice(-steps)

    console.log(`Rolling back ${toRollback.length} migration(s)\n`)

    for (const version of toRollback.reverse()) {
      console.log(`Rolling back migration ${version}`)

      // Down files are named with the same zero-padded prefix, e.g. 001_down.sql
      const downFile = path.join(__dirname, 'migrations', `${version}_down.sql`)

      if (!fs.existsSync(downFile)) {
        console.error(`✗ No rollback script found for migration ${version}`)
        console.error(`  Expected file: ${downFile}`)
        continue
      }

      const sql = fs.readFileSync(downFile, 'utf-8')

      try {
        await this.client.query('BEGIN')
        await this.client.query(sql)
        await this.client.query('DELETE FROM schema_migrations WHERE version = $1', [version])
        await this.client.query('COMMIT')

        console.log(`✓ Migration ${version} rolled back successfully\n`)
      } catch (error) {
        await this.client.query('ROLLBACK')
        console.error(`✗ Rollback of migration ${version} failed:`, error)
        throw error
      }
    }

    console.log(`✓ Rollback completed`)
  }

  async status(): Promise<void> {
    const applied = await this.getAppliedMigrations()
    const pending = await this.getPendingMigrations()
    const all = this.loadMigrations()

    console.log('\n📊 Migration Status\n')
    console.log('─'.repeat(60))

    if (all.length === 0) {
      console.log('No migrations found')
      console.log('─'.repeat(60))
      return
    }

    console.log(`Total migrations: ${all.length}`)
    console.log(`Applied: ${applied.length}`)
    console.log(`Pending: ${pending.length}`)
    console.log('─'.repeat(60))
    console.log('')

    if (applied.length > 0) {
      console.log('✓ Applied Migrations:')
      for (const version of applied) {
        const migration = all.find((m) => m.version === version)
        console.log(`  ${version}: ${migration?.name || 'unknown'}`)
      }
      console.log('')
    }

    if (pending.length > 0) {
      console.log('⏳ Pending Migrations:')
      for (const migration of pending) {
        console.log(`  ${migration.version}: ${migration.name}`)
      }
      console.log('')
    }

    console.log('─'.repeat(60))
  }
}

// CLI
const command = process.argv[2]
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('✗ DATABASE_URL environment variable not set')
  console.error('\nUsage:')
  console.error('  DATABASE_URL=postgresql://... npm run migrate [up|down|status]')
  process.exit(1)
}

const runner = new MigrationRunner(connectionString)

;(async () => {
  try {
    await runner.connect()

    switch (command) {
      case 'up':
        await runner.runMigrations()
        break

      case 'down': {
        const steps = parseInt(process.argv[3] || '1')
        await runner.rollback(steps)
        break
      }

      case 'status':
        await runner.status()
        break

      default:
        console.log('Usage: npm run migrate [up|down|status]')
        console.log('')
        console.log('Commands:')
        console.log('  up             Apply all pending migrations')
        console.log('  down [steps]   Rollback migrations (default: 1)')
        console.log('  status         Show migration status')
        process.exit(1)
    }
  } catch (error) {
    console.error('\n✗ Migration failed:', error)
    process.exit(1)
  } finally {
    await runner.disconnect()
  }
})()
