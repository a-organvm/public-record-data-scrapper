# Repo-Wide Runtime De-Mock Plan

Date: 2026-03-23
Repo: `public-record-data-scrapper`

## Goal

Remove runtime-facing mock behavior and mock wording across the software suite so the product either:

1. uses a real provider/data path, or
2. fails explicitly with an unconfigured/unsupported status.

Tests may continue to use mocking for isolation.

## Inventory Summary

As of this plan, `apps/web/src` and `server` contain 29 non-test runtime files with `mock`/`Mock` references.

High-impact runtime categories:

1. User-facing UI/demo wording
2. Explicit fake data generation in runtime services
3. Stub integrations returning synthetic provider responses
4. Legacy placeholder collectors still registered in runtime factories

## Phases

### Phase 1: User-Facing Runtime Cleanup

- Replace runtime UI copy that says `mock` with truthful alternatives such as `demo`, `preview`, `sample`, `stub`, or `unconfigured` depending on meaning.
- Stop new coverage/analytics/runtime views from advertising mock fallback.
- Introduce neutral alias modules where needed so touched app code stops importing `mockData` directly.

### Phase 2: Fail-Closed Service Behavior

- Replace fake runtime responses with explicit failures or empty/unconfigured results in:
  - enrichment
  - Plaid
  - LLM/generative fallback paths
  - other integration stubs that currently fabricate success payloads
- Ensure API routes surface these states clearly instead of silently inventing data.

### Phase 3: Collector/Feature Graph Cleanup

- Remove or isolate legacy placeholder collectors from runtime factory resolution.
- Update data-pipeline status/settings/search surfaces so “demo” or “preview” is clearly opt-in and never the default production path.
- Re-verify scheduler, ingestion, enrichment, and UI state transitions.

## Execution Notes

- Runtime truthfulness takes priority over backwards-compatible fake behavior.
- Test mocking remains allowed and is not part of the runtime de-mock objective.
- Prefer fail-loud over fabricated data.
- Keep environment variables stable where changing them repo-wide would create unnecessary breakage; use neutral aliases in code where practical.

## Immediate Next Slice

1. Remove `mock` terminology from runtime-facing UI and newly touched runtime files.
2. Convert major fake-response services from “invent data” to explicit unsupported/unconfigured errors.
3. Run focused lint/tests after each slice.
