/**
 * Audit Middleware
 *
 * Intercepts all mutating API requests (POST, PUT, PATCH, DELETE) and logs
 * them to the audit_logs table for compliance tracking. The audit logs are
 * immutable and cannot be modified or deleted after creation.
 *
 * Features:
 * - Captures before/after state for entity changes
 * - Records user context (IP, user agent, request ID)
 * - Skips health checks and other non-auditable endpoints
 * - Async logging to avoid blocking requests
 */

import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { database } from '../database/connection'
import type { AuthenticatedRequest } from './authMiddleware'

// Endpoints that should not be audited
const SKIP_AUDIT_PATHS = [
  '/api/health',
  '/api/health/ready',
  '/api/health/live',
  '/api/metrics',
  '/api/jobs/status',
  '/api/auth/refresh',
  '/api/auth/logout'
]

// HTTP methods that trigger auditing
const AUDITABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Map of paths to entity types
const ENTITY_TYPE_MAP: Record<string, string> = {
  '/api/prospects': 'prospect',
  '/api/contacts': 'contact',
  '/api/deals': 'deal',
  '/api/communications': 'communication',
  '/api/disclosures': 'disclosure',
  '/api/consent': 'consent',
  '/api/dnc': 'dnc_entry',
  '/api/portfolio': 'portfolio',
  '/api/competitors': 'competitor'
}

// Map of HTTP methods to action names
const ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete'
}

interface AuditContext {
  requestId: string
  userId?: string
  orgId?: string
  action: string
  entityType: string
  entityId?: string
  ipAddress?: string
  userAgent?: string
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  changes?: Record<string, { old: unknown; new: unknown }>
}

/**
 * Extract entity type from request path
 */
function getEntityType(path: string): string {
  for (const [prefix, type] of Object.entries(ENTITY_TYPE_MAP)) {
    if (path.startsWith(prefix)) {
      return type
    }
  }
  return 'unknown'
}

/**
 * Extract entity ID from request path (assumes /api/{resource}/{id} pattern)
 */
function extractEntityId(path: string): string | undefined {
  const parts = path.split('/')
  // Pattern: /api/resource/:id or /api/resource/:id/action
  if (parts.length >= 4) {
    const potentialId = parts[3]
    // Basic UUID validation
    if (potentialId && /^[0-9a-f-]{36}$/i.test(potentialId)) {
      return potentialId
    }
  }
  return undefined
}

/**
 * Calculate changes between before and after states
 */
function calculateChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): Record<string, { old: unknown; new: unknown }> | undefined {
  if (!before || !after) {
    return undefined
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {}
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of allKeys) {
    const oldVal = before[key]
    const newVal = after[key]

    // Skip internal/timestamp fields
    if (['created_at', 'updated_at', 'createdAt', 'updatedAt'].includes(key)) {
      continue
    }

    // Compare JSON stringified values for deep comparison
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { old: oldVal, new: newVal }
    }
  }

  return Object.keys(changes).length > 0 ? changes : undefined
}

/**
 * Asynchronously write audit log to database
 * Does not block the response
 */
async function writeAuditLog(context: AuditContext): Promise<void> {
  try {
    await database.query(
      `INSERT INTO audit_logs (
        org_id, user_id, action, entity_type, entity_id,
        changes, before_state, after_state,
        ip_address, user_agent, request_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11)`,
      [
        context.orgId || null,
        context.userId || null,
        context.action,
        context.entityType,
        context.entityId || null,
        context.changes ? JSON.stringify(context.changes) : null,
        context.beforeState ? JSON.stringify(context.beforeState) : null,
        context.afterState ? JSON.stringify(context.afterState) : null,
        context.ipAddress || null,
        context.userAgent || null,
        context.requestId
      ]
    )
  } catch (error) {
    // Log error but don't fail the request
    console.error('[AuditMiddleware] Failed to write audit log:', error)
  }
}

const SENSITIVE_FIELDS = [
  'password',
  'ssn',
  'socialSecurityNumber',
  'bankAccount',
  'accountNumber',
  'routingNumber',
  'creditCard',
  'cardNumber',
  'cvv',
  'pin',
  'secret',
  'token',
  'apiKey'
]

// Pre-compute the normalized set of sensitive key names (lowercased, with both
// camelCase and snake_case variants) for efficient recursive matching.
const SENSITIVE_KEY_SET = new Set<string>(
  SENSITIVE_FIELDS.flatMap((field) => {
    const snakeCase = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    return [field.toLowerCase(), snakeCase.toLowerCase()]
  })
)

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SET.has(key.toLowerCase())
}

/**
 * Recursively redact a single value (handles objects and arrays).
 */
function redactValue(value: unknown, depth: number): unknown {
  // Guard against deeply nested / cyclic-like structures.
  if (depth > 8) return '[TRUNCATED]'

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1))
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(source)) {
      if (isSensitiveKey(key)) {
        out[key] = '[REDACTED]'
      } else {
        out[key] = redactValue(val, depth + 1)
      }
    }
    return out
  }

  return value
}

/**
 * Redact sensitive fields from audit logs.
 *
 * Recurses into nested objects and arrays so sensitive values are masked at any
 * depth (the previous implementation only redacted top-level keys, leaking e.g.
 * `payment.cardNumber`).
 */
function redactSensitiveData(
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!data) return undefined
  return redactValue(data, 0) as Record<string, unknown>
}

/**
 * Express middleware for auditing API mutations
 */
export const auditMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  // Skip non-auditable methods
  if (!AUDITABLE_METHODS.includes(req.method)) {
    return next()
  }

  // Skip excluded paths
  if (SKIP_AUDIT_PATHS.some((path) => req.path.startsWith(path))) {
    return next()
  }

  // Generate or use existing request ID
  const requestId =
    (req as Request & { correlationId?: string }).correlationId || uuidv4()

  // Build audit context
  const auditContext: AuditContext = {
    requestId,
    userId: req.user?.id,
    orgId: (req as AuthenticatedRequest & { orgId?: string }).orgId,
    action: ACTION_MAP[req.method] || req.method.toLowerCase(),
    entityType: getEntityType(req.path),
    entityId: extractEntityId(req.path) || req.body?.id,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  }

  // Store original body for before state comparison
  const originalBody = req.body ? { ...req.body } : undefined

  // Ensure we only write a single audit record even if both res.json and
  // res.send are invoked for the same response.
  let audited = false

  /**
   * Build and persist the audit record from the (optional) response body.
   * `body` may be a parsed object (from res.json) or undefined (e.g. a 204
   * res.send() with no payload).
   */
  const processAudit = (body: unknown): void => {
    if (audited) return
    audited = true

    setImmediate(async () => {
      try {
        const responseObject =
          body && typeof body === 'object' && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : undefined
        const isErrorResponse = !!responseObject && 'error' in responseObject

        // For creates, the response body is the after state
        if (auditContext.action === 'create' && responseObject && !isErrorResponse) {
          auditContext.afterState = redactSensitiveData(responseObject)
        }

        // For updates, calculate changes between request body and response
        if (
          auditContext.action === 'update' &&
          originalBody &&
          responseObject &&
          !isErrorResponse
        ) {
          auditContext.beforeState = redactSensitiveData(originalBody)
          auditContext.afterState = redactSensitiveData(responseObject)
          auditContext.changes = calculateChanges(
            redactSensitiveData(originalBody),
            redactSensitiveData(responseObject)
          )
        }

        // For deletes, the request body or params contain the entity info.
        // Deletes commonly return 204 with no body (res.send), so this path is
        // essential to ensure delete mutations are audited.
        if (auditContext.action === 'delete') {
          auditContext.beforeState = redactSensitiveData(originalBody)
        }

        // Only log successful (non-error) responses
        if (res.statusCode < 400) {
          await writeAuditLog(auditContext)
        }
      } catch (error) {
        console.error('[AuditMiddleware] Error processing audit:', error)
      }
    })
  }

  // Capture original methods
  const originalJson = res.json.bind(res)
  const originalSend = res.send.bind(res)

  // Override res.json to capture structured response bodies.
  res.json = function (body: Record<string, unknown>): Response {
    processAudit(body)
    return originalJson(body)
  }

  // Override res.send to capture responses that bypass res.json — notably 204
  // No Content responses from DELETE handlers, which would otherwise skip audit.
  res.send = function (body?: unknown): Response {
    let parsed: unknown = body
    // res.send may receive a JSON string; try to parse for richer audit data.
    if (typeof body === 'string') {
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = undefined
      }
    }
    processAudit(parsed)
    return originalSend(body)
  }

  next()
}

/**
 * Helper to manually create an audit log entry
 * Useful for custom audit scenarios not handled by middleware
 */
export async function createAuditLog(params: {
  orgId?: string
  userId?: string
  action: string
  entityType: string
  entityId?: string
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  changes?: Record<string, { old: unknown; new: unknown }>
  ipAddress?: string
  userAgent?: string
  requestId?: string
}): Promise<void> {
  const context: AuditContext = {
    ...params,
    requestId: params.requestId || uuidv4(),
    beforeState: redactSensitiveData(params.beforeState),
    afterState: redactSensitiveData(params.afterState)
  }
  await writeAuditLog(context)
}

export default auditMiddleware
