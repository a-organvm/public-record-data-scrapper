# Repository Guidelines

Global policy: /Users/4jp/AGENTS.md applies and cannot be overridden.

## Project Structure & Module Organization

- `src/` contains the Vite/React app. Key areas: `components/` (UI and feature components), `components/ui/` (Radix wrappers), `hooks/`, `lib/` (agentic engine, collectors, scrapers, services), `styles/`, and `types/`.
- `server/` is the Express API and worker process for queues and background jobs.
- `scripts/` holds CLI utilities (scraping, DB tasks, video tooling).
- `tests/` contains `integration/` and `e2e/` suites. Unit tests live alongside code in `src/**/__tests__` and `*.test.ts(x)`.
- `database/` has schema files; `terraform/` and `k8s/` cover infrastructure; `public/` stores static assets.

## Build, Test, and Development Commands

- `npm install` installs dependencies (Node 18+ recommended).
- `npm run dev` starts the Vite dev server (port 5000).
- `npm run build` runs the TypeScript build step (no diagnostics) and Vite production build; `npm run preview` serves the build.
- `npm run lint` runs ESLint.
- `npm test` runs Vitest; `npm run test:coverage` generates coverage.
- `npm run test:e2e` runs Playwright; `npm run test:scrapers:ca` targets a single state.
- `npm run scrape -- scrape-ucc -c "Company" -s CA -o results.json` runs the CLI scraper.
- `npm run db:migrate` and `npm run db:test` handle database setup checks.

## Coding Style & Naming Conventions

- TypeScript + React. Follow React hooks rules and keep components focused and reusable.
- Prettier config: 2-space indentation, single quotes, no semicolons, 100 column print width. ESLint enforces code quality.
- Use PascalCase for components, `useX` for hooks, and `*.test.ts(x)` for tests.
- Update `src/lib/types.ts` first when changing data shapes.

## Testing Guidelines

- Unit and integration tests: Vitest with jsdom (`src/**/__tests__`, `*.test.ts`).
- Integration suites: `tests/integration/`.
- End-to-end: Playwright in `tests/e2e/`.
- Run the smallest relevant suite before PRs, then full `npm test` if you touched shared logic.

## Commit & Pull Request Guidelines

- Commit messages are imperative and descriptive; include a short summary and a brief bullet list of key changes. Add issue references and `Co-Authored-By` when needed.
- Before opening a PR, run `npm run lint` and the relevant test suites, and note what you ran in the PR description. Update README/docs when behavior changes.

## Security & Configuration Tips

- Copy `.env.example` to `.env` for local development and keep secrets out of Git.
- Prefer environment variables and secrets managers for production credentials.

<!-- ORGANVM:AUTO:START -->

## Agent Context (auto-generated — do not edit)

This repo participates in the **ORGAN-III (Commerce)** swarm.

### Active Subscriptions

- Event: `governance.updated` → Action: Check compliance with updated governance rules
- Event: `health-audit.completed` → Action: Review audit findings for this repo

### Production Responsibilities

- **Produce** `dependency` for organvm-v-logos/public-process

### External Dependencies

- _No external dependencies_

### Governance Constraints

- Adhere to unidirectional flow: I→II→III
- Never commit secrets or credentials

_Last synced: 2026-03-20T10:58:28Z_

<!-- ORGANVM:AUTO:END -->
