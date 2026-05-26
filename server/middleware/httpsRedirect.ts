import { Request, Response, NextFunction } from 'express'
import { config } from '../config'

/**
 * HTTPS redirect middleware for production environments
 *
 * This middleware:
 * 1. Redirects HTTP requests to HTTPS in production
 * 2. Adds HSTS (HTTP Strict Transport Security) header
 *
 * Note: When behind a reverse proxy (AWS ALB, Nginx, etc.),
 * the proxy typically handles TLS termination. The original
 * protocol is passed via X-Forwarded-Proto header.
 */
/**
 * Resolve the canonical host to use when building the HTTPS redirect target.
 *
 * Prefer a configured canonical public URL (config.app.publicUrl) so the
 * redirect target is NOT derived from the attacker-controlled Host header,
 * which would otherwise enable an open-redirect. Only fall back to the request
 * Host header when no canonical URL is configured.
 *
 * TODO(security): always configure PUBLIC_URL/APP_URL in production so we never
 * trust the request Host for redirects.
 */
function resolveRedirectHost(req: Request): string {
  const publicUrl = (config as { app?: { publicUrl?: string } }).app?.publicUrl
  if (publicUrl) {
    try {
      return new URL(publicUrl).host
    } catch {
      // fall through to request host
    }
  }
  return req.headers.host || ''
}

export const httpsRedirect = (req: Request, res: Response, next: NextFunction): void => {
  // Only enforce HTTPS in production
  if (config.server.env !== 'production') {
    return next()
  }

  // Determine if the request arrived over HTTPS. With `trust proxy` configured
  // (see server/index.ts), Express derives req.secure from the (now trusted)
  // X-Forwarded-Proto, so we rely on req.secure rather than reading the raw,
  // spoofable header ourselves. req.connection.encrypted covers direct TLS.
  const protocol = req.headers['x-forwarded-proto']
  const isHttps =
    req.secure || protocol === 'https' || (req.connection as { encrypted?: boolean })?.encrypted

  if (!isHttps) {
    // 301 Permanent Redirect to HTTPS using a trusted/canonical host.
    const httpsUrl = `https://${resolveRedirectHost(req)}${req.url}`
    res.redirect(301, httpsUrl)
    return
  }

  // Add HSTS header for HTTPS requests
  // max-age: 1 year (31536000 seconds)
  // includeSubDomains: Apply to all subdomains
  // preload: Allow inclusion in browser preload lists
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')

  next()
}

/**
 * Configurable HTTPS redirect with options
 */
interface HttpsRedirectOptions {
  enabled?: boolean
  hstsMaxAge?: number
  includeSubDomains?: boolean
  preload?: boolean
}

export function createHttpsRedirect(
  options: HttpsRedirectOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const {
    enabled = config.server.env === 'production',
    hstsMaxAge = 31536000,
    includeSubDomains = true,
    preload = true
  } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      return next()
    }

    const protocol = req.headers['x-forwarded-proto']
    const isHttps =
      req.secure || protocol === 'https' || (req.connection as { encrypted?: boolean })?.encrypted

    if (!isHttps) {
      const httpsUrl = `https://${resolveRedirectHost(req)}${req.url}`
      res.redirect(301, httpsUrl)
      return
    }

    // Build HSTS header
    let hstsValue = `max-age=${hstsMaxAge}`
    if (includeSubDomains) hstsValue += '; includeSubDomains'
    if (preload) hstsValue += '; preload'

    res.setHeader('Strict-Transport-Security', hstsValue)
    next()
  }
}
