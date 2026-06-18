import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadConfigWithEnv(env: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, env)
  vi.resetModules()
  return import('../config')
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
  vi.resetModules()
})

describe('server config', () => {
  it('parses TRUST_PROXY=1 as a single trusted proxy hop', async () => {
    const { parseTrustProxy } = await loadConfigWithEnv({
      ...originalEnv,
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test'
    })

    expect(parseTrustProxy('1')).toBe(1)
    expect(parseTrustProxy('2')).toBe(2)
    expect(parseTrustProxy('true')).toBe(true)
    expect(parseTrustProxy('0')).toBe(false)
    expect(parseTrustProxy(undefined)).toBe(false)
  })

  it('fails production validation when security prerequisites are missing', async () => {
    const { validateConfig } = await loadConfigWithEnv({
      NODE_ENV: 'production'
    })

    expect(() => validateConfig()).toThrow(/JWT_SECRET is required/)
    expect(() => validateConfig()).toThrow(/DATABASE_URL is required/)
    expect(() => validateConfig()).toThrow(/STRIPE_WEBHOOK_SECRET is required/)
    expect(() => validateConfig()).toThrow(/TWILIO_AUTH_TOKEN is required/)
    expect(() => validateConfig()).toThrow(/SENDGRID_WEBHOOK_VERIFICATION_KEY is required/)
    expect(() => validateConfig()).toThrow(/PLAID_CLIENT_ID is required/)
    expect(() => validateConfig()).toThrow(/PLAID_SECRET is required/)
  })

  it('accepts the complete production deployment prerequisite set', async () => {
    const { validateConfig } = await loadConfigWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-secret',
      DATABASE_URL: 'postgresql://ucc_mca_app:secret@db.example.com:5432/ucc_mca',
      CORS_ORIGIN: 'https://app.example.com',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      TWILIO_AUTH_TOKEN: 'twilio-token',
      SENDGRID_WEBHOOK_VERIFICATION_KEY: 'sendgrid-key',
      PLAID_CLIENT_ID: 'plaid-client-id',
      PLAID_SECRET: 'plaid-secret'
    })

    expect(() => validateConfig()).not.toThrow()
  })
})
