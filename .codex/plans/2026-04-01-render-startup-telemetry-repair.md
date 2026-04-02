## Goal

Stabilize `ucc-mca-api` production startup on Render by aligning the runtime with the bundled server artifact and repairing telemetry schema drift.

## Scope

1. Change the production `start` script to execute `dist/server.cjs`.
2. Add `available_strategies` to the ingestion telemetry schema for fresh installs.
3. Add a forward migration that repairs existing databases whether the column is missing or currently constrained.
4. Bound telemetry hydration at startup and allow it to be skipped via environment configuration.
5. Run focused server tests and a production build to verify the path.
