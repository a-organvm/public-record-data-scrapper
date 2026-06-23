/**
 * Shared primitives for discovery channels.
 *
 * Every key-less channel repeats the same handful of concerns: clamp the
 * caller's `limit`, normalise a two-letter state code, fetch with a hard
 * timeout, and wrap the fetch→ok→json dance in {@link DiscoveryChannelError}s
 * with a channel-specific label. These were copy-pasted into each channel;
 * they now live here so the behaviour (and its fail-closed error messages) is
 * defined exactly once.
 *
 * @module server/services/discovery-channels/utils
 */

import { DiscoveryChannelError } from './types'

/** Default candidate cap when the caller does not specify one. */
export const DEFAULT_LIMIT = 25
/** Hard upper bound on candidates a single channel will return. */
export const MAX_LIMIT = 200

/**
 * Coerce a caller-supplied `limit` into a sane positive integer in
 * `[1, MAX_LIMIT]`, falling back to {@link DEFAULT_LIMIT} for missing or
 * non-finite values.
 */
export function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

/**
 * Normalise a state filter to an upper-case two-letter code, or null when
 * absent / not exactly two characters (a malformed filter is treated as "no
 * filter" rather than silently matching nothing).
 */
export function normalizeState(state?: string): string | null {
  if (!state) return null
  const trimmed = state.trim().toUpperCase()
  return trimmed.length === 2 ? trimmed : null
}

/** Human-readable message for an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * `fetch` with a hard timeout. An optional `externalSignal` (e.g. a stream
 * "limit reached" abort) is forwarded into the timeout controller so a single
 * signal tears the request down either way.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  { timeoutMs, externalSignal }: { timeoutMs: number; externalSignal?: AbortSignal }
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Fetch a URL expected to return JSON, failing closed at each step with a
 * named {@link DiscoveryChannelError}. `label` prefixes every message (e.g.
 * `'SEC EDGAR'` → `'SEC EDGAR unreachable: ...'`). Returns the parsed body as
 * `unknown`; callers validate its documented shape.
 */
export async function fetchJson(
  channel: string,
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchWithTimeout(url, init, { timeoutMs })
  } catch (err) {
    throw new DiscoveryChannelError(channel, `${label} unreachable: ${errorMessage(err)}`)
  }
  if (!response.ok) {
    throw new DiscoveryChannelError(
      channel,
      `${label} returned HTTP ${response.status} ${response.statusText}`
    )
  }
  try {
    return await response.json()
  } catch (err) {
    throw new DiscoveryChannelError(
      channel,
      `${label} response was not valid JSON: ${errorMessage(err)}`
    )
  }
}
