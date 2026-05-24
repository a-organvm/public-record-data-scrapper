import type { Request, Response, NextFunction } from 'express'

export type RequestedDataTier = 'oss' | 'paid' | 'unknown'
export type ResolvedDataTier = 'free-tier' | 'starter-tier'

export interface DataTierContext {
  requested: RequestedDataTier
  resolved: ResolvedDataTier
}

export interface DataTierRequest extends Request {
  dataTier?: DataTierContext
  // Populated by authMiddleware; used as the trusted entitlement source.
  user?: { id: string; email?: string; role?: string; orgId?: string }
}

const OSS_ALIASES = new Set(['oss', 'open', 'free', 'free-tier', 'community', 'base'])

const PAID_ALIASES = new Set(['paid', 'starter', 'starter-tier', 'pro', 'premium'])

// The most restrictive tier — used as the fail-safe default so a client cannot
// escalate its entitlement by sending a header.
const DEFAULT_RESOLVED_TIER: ResolvedDataTier = 'free-tier'

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (!value) return ''
  const raw = Array.isArray(value) ? value[0] : value
  return raw.trim().toLowerCase()
}

/**
 * Classify the *requested* tier expressed by the client.
 *
 * NOTE: this is advisory/diagnostic only. It is NEVER used to grant access —
 * the resolved tier is derived from a trusted server-side source (see
 * resolveServerSideTier). Retained for telemetry and signature stability.
 */
export function resolveRequestedDataTier(
  headerValue: string | string[] | undefined
): RequestedDataTier {
  const normalized = normalizeHeaderValue(headerValue)
  if (!normalized) return 'oss'
  if (OSS_ALIASES.has(normalized)) return 'oss'
  if (PAID_ALIASES.has(normalized)) return 'paid'
  return 'unknown'
}

/**
 * Resolve the entitlement tier from a TRUSTED server-side source.
 *
 * The client-supplied `x-data-tier` header is intentionally ignored here to
 * prevent paywall bypass. We default to the most restrictive tier.
 *
 * TODO(security): wire real entitlement lookup (subscription/plan keyed by
 * req.user.orgId or req.user.id) once a billing/entitlement source exists. For
 * now any unauthenticated or un-entitled request resolves to 'free-tier'.
 */
function resolveServerSideTier(req: Request): ResolvedDataTier {
  // Placeholder for a real entitlement source. When subscriptions are wired,
  // look up the plan for req.user.orgId here. Until then, fail closed.
  void (req as DataTierRequest).user
  return DEFAULT_RESOLVED_TIER
}

/**
 * Resolve the effective data tier. Signature kept stable for callers/tests, but
 * the header argument is now IGNORED — the tier is derived server-side and
 * defaults to the most restrictive value.
 */
export function resolveDataTier(_headerValue?: string | string[] | undefined): ResolvedDataTier {
  return DEFAULT_RESOLVED_TIER
}

export function getResolvedDataTier(req: Request): ResolvedDataTier {
  const cached = (req as DataTierRequest).dataTier?.resolved
  return cached ?? resolveServerSideTier(req)
}

export function getDataTierContext(req: Request): DataTierContext {
  const cached = (req as DataTierRequest).dataTier
  if (cached) return cached
  // `requested` reflects what the client asked for (advisory only); `resolved`
  // is the trusted, server-derived entitlement.
  const requested = resolveRequestedDataTier(req.headers['x-data-tier'])
  return {
    requested,
    resolved: resolveServerSideTier(req)
  }
}

export const dataTierRouter = (req: Request, res: Response, next: NextFunction): void => {
  const context = getDataTierContext(req)
  ;(req as DataTierRequest).dataTier = context
  res.setHeader('x-data-tier-resolved', context.resolved)
  next()
}
