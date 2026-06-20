#!/usr/bin/env tsx

import { Buffer } from 'node:buffer'
import { Pool } from 'pg'
import { config as loadDotenv } from 'dotenv'

loadDotenv()

const REQUIRED_ENV = [
  'JWT_SECRET',
  'API_KEY_ISSUER_SECRET',
  'DATABASE_URL',
  'CORS_ORIGIN',
  'STRIPE_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN',
  'SENDGRID_WEBHOOK_VERIFICATION_KEY',
  'PLAID_CLIENT_ID',
  'PLAID_SECRET'
]

const HARDENING_MIGRATIONS = ['014', '015', '016', '017', '018', '019']

const ORG_SCOPED_TABLES = [
  'prospects',
  'contacts',
  'deals',
  'communications',
  'consent_records',
  'deal_stages',
  'lenders',
  'communication_templates',
  'follow_up_reminders',
  'disclosures',
  'dnc_list',
  'compliance_alerts',
  'api_keys'
]

const PLACEHOLDER_PATTERN =
  /^(your-|change[-_ ]?me|replace(_with)?|example|test-secret|dev-secret|placeholder)/i

interface CheckState {
  errors: string[]
  warnings: string[]
}

function normalizeMigrationVersion(version: unknown): string {
  const raw = String(version).trim()
  return /^\d+$/.test(raw) ? raw.padStart(3, '0') : raw
}

function addError(state: CheckState, message: string): void {
  state.errors.push(message)
}

function addWarning(state: CheckState, message: string): void {
  state.warnings.push(message)
}

function hasValue(name: string): boolean {
  return Boolean((process.env[name] ?? '').trim())
}

function checkRequiredEnv(state: CheckState): void {
  for (const name of REQUIRED_ENV) {
    const value = (process.env[name] ?? '').trim()
    if (!value) {
      addError(state, `${name} is required`)
      continue
    }
    if (PLACEHOLDER_PATTERN.test(value)) {
      addError(state, `${name} still looks like a placeholder`)
    }
  }

  if ((process.env.JWT_SECRET ?? '').trim().length > 0 && process.env.JWT_SECRET!.length < 32) {
    addError(state, 'JWT_SECRET must be at least 32 characters')
  }
  if (
    (process.env.API_KEY_ISSUER_SECRET ?? '').trim().length > 0 &&
    process.env.API_KEY_ISSUER_SECRET!.length < 32
  ) {
    addError(state, 'API_KEY_ISSUER_SECRET must be at least 32 characters')
  }

  const plaidEnv = process.env.PLAID_ENV || 'sandbox'
  if (!['sandbox', 'development', 'production'].includes(plaidEnv)) {
    addError(state, 'PLAID_ENV must be one of: sandbox, development, production')
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function findClaim(payload: Record<string, unknown>, claimName: string, suffixes: string[]): unknown {
  if (typeof payload[claimName] === 'string' && payload[claimName]) {
    return payload[claimName]
  }

  const lowerSuffixes = suffixes.map((suffix) => suffix.toLowerCase())
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase()
    if (lowerSuffixes.some((suffix) => lowerKey.endsWith(suffix))) {
      return value
    }
  }
  return undefined
}

function checkExternalConfirmations(state: CheckState): void {
  const sampleToken = process.env.DEPLOY_PREREQ_ACCESS_TOKEN
  if (sampleToken) {
    const payload = decodeJwtPayload(sampleToken)
    if (!payload) {
      addError(state, 'DEPLOY_PREREQ_ACCESS_TOKEN is not a decodable JWT')
    } else {
      const orgClaim = findClaim(payload, process.env.JWT_ORG_CLAIM || 'org_id', [
        '/org_id',
        '/orgid'
      ])
      if (typeof orgClaim !== 'string' || orgClaim.length === 0) {
        addError(state, 'DEPLOY_PREREQ_ACCESS_TOKEN is missing an org_id/orgId claim')
      }
    }
  } else if (process.env.JWT_ORG_CLAIM_CONFIRMED !== 'true') {
    addError(
      state,
      'JWT_ORG_CLAIM_CONFIRMED=true is required, or provide DEPLOY_PREREQ_ACCESS_TOKEN with org_id'
    )
  }

  if (process.env.DATA_TIER_MAPPING_CONFIRMED !== 'true') {
    addError(
      state,
      'DATA_TIER_MAPPING_CONFIRMED=true is required after confirming subscription_tier mapping'
    )
  }

  if (!hasValue('JWT_TIER_CLAIM')) {
    addWarning(
      state,
      'JWT_TIER_CLAIM is not set; default "tier" plus namespaced /tier and /plan claims will be used'
    )
  }
}

async function checkDatabase(state: CheckState): Promise<void> {
  if (!process.env.DATABASE_URL) return

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  try {
    const roleResult = await pool.query<{
      role_name: string
      rolsuper: boolean
      rolbypassrls: boolean
    }>(
      `
        SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls
        FROM pg_roles r
        WHERE r.rolname = current_user
      `
    )
    const role = roleResult.rows[0]
    if (!role) {
      addError(state, 'Could not resolve current database role')
      return
    }

    if (role.rolsuper) {
      addError(state, `DATABASE_URL connects as superuser role "${role.role_name}"`)
    }
    if (role.rolbypassrls) {
      addError(state, `DATABASE_URL connects as BYPASSRLS role "${role.role_name}"`)
    }

    const migrations = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations'
    )
    const appliedVersions = new Set(
      migrations.rows.map((row) => normalizeMigrationVersion(row.version))
    )
    const missingMigrations = HARDENING_MIGRATIONS.filter((version) => !appliedVersions.has(version))
    if (missingMigrations.length > 0) {
      addError(
        state,
        `Missing hardening migrations in schema_migrations: ${missingMigrations.join(', ')}`
      )
    }

    const functionResult = await pool.query<{ fn_exists: boolean }>(
      "SELECT to_regprocedure('public.app_current_org_id()') IS NOT NULL AS fn_exists"
    )
    if (!functionResult.rows[0]?.fn_exists) {
      addError(state, 'app_current_org_id() is missing; migration 018 did not install RLS helper')
    }

    const tableResult = await pool.query<{
      relname: string
      owner_name: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>(
      `
        SELECT
          c.relname,
          pg_get_userbyid(c.relowner) AS owner_name,
          c.relrowsecurity,
          c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
      `,
      [ORG_SCOPED_TABLES]
    )

    const presentTables = new Set(tableResult.rows.map((row) => row.relname))
    for (const row of tableResult.rows) {
      if (!row.relrowsecurity) {
        addError(state, `RLS is not enabled on public.${row.relname}`)
      }
      if (row.owner_name === role.role_name && !row.relforcerowsecurity) {
        addError(
          state,
          `DATABASE_URL role "${role.role_name}" owns public.${row.relname}; use a non-owner app role`
        )
      }
    }

    const policyResult = await pool.query<{ tablename: string }>(
      `
        SELECT tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname = 'tenant_isolation'
          AND tablename = ANY($1::text[])
      `,
      [ORG_SCOPED_TABLES]
    )
    const policyTables = new Set(policyResult.rows.map((row) => row.tablename))
    for (const table of presentTables) {
      if (!policyTables.has(table)) {
        addError(state, `tenant_isolation RLS policy is missing on public.${table}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    addError(state, `Database prerequisite check failed: ${message}`)
  } finally {
    await pool.end()
  }
}

async function main(): Promise<void> {
  const state: CheckState = { errors: [], warnings: [] }

  checkRequiredEnv(state)
  checkExternalConfirmations(state)
  await checkDatabase(state)

  for (const warning of state.warnings) {
    console.warn(`WARN ${warning}`)
  }

  if (state.errors.length > 0) {
    console.error('Deploy prerequisites failed:')
    for (const error of state.errors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }

  console.log('Deploy prerequisites verified.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
