import { AsyncLocalStorage } from 'node:async_hooks'
import { Response, NextFunction } from 'express'
import type { AuthenticatedRequest } from './authMiddleware'

/**
 * Per-request tenant (organization) context.
 *
 * This middleware captures the authenticated user's `orgId` (populated by
 * authMiddleware from the verified JWT) and stashes it in an
 * AsyncLocalStorage store for the lifetime of the request handler chain. The
 * core Database client reads from this store (via an injected provider — see
 * `setOrgContextProvider` in packages/core/src/database.ts) so it can SET the
 * Postgres GUC `app.current_org_id` on the connection used for each query.
 *
 * The GUC is what migration 018 (Row-Level Security) keys its
 * `tenant_isolation` policies off of (via the `app_current_org_id()` SQL
 * function). Without this wiring the policies are inert.
 *
 * IMPORTANT — RLS only enforces under a NON-OWNER DB role:
 *   The `tenant_isolation` policies are NOT created with FORCE, so the table
 *   OWNER (and any role with BYPASSRLS, e.g. superuser) is exempt and sees all
 *   rows regardless of the GUC. Migrations run as the owner — that is
 *   deliberate so admin tooling keeps working. For tenant isolation to
 *   actually take effect at runtime, the application MUST connect as a
 *   dedicated non-owner role that is subject to RLS.
 */

interface OrgContextStore {
  orgId?: string
}

const store = new AsyncLocalStorage<OrgContextStore>()

/**
 * Returns the orgId bound to the current async execution context, or
 * `undefined` when no org context has been established (e.g. unauthenticated
 * requests, background jobs, or tests that run without the middleware).
 */
export function getCurrentOrgId(): string | undefined {
  return store.getStore()?.orgId
}

/**
 * Express middleware that binds the authenticated user's `orgId` to the
 * AsyncLocalStorage store for the duration of the downstream handler chain.
 *
 * When `req.user?.orgId` is absent (unauthenticated route, or a token without
 * an org claim) it is a transparent pass-through — `next()` runs outside any
 * org context, so the core DB client takes its plain `pool.query` path.
 *
 * Mount this AFTER authMiddleware (which populates `req.user`) and BEFORE the
 * protected routers that issue tenant-scoped queries.
 */
export function orgContextMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const orgId = req.user?.orgId
  if (orgId) {
    store.run({ orgId }, next)
    return
  }
  next()
}
