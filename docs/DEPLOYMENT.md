# Deployment Gate for PR #234 Security Hardening

This gate tracks the production prerequisites from issue #235. Complete it
before deploying the security hardening from PR #234 to live traffic.

## 1. Identity Claims

Auth0 must issue an organization claim on every API access token. The server
accepts:

- `org_id`
- a namespaced custom claim ending in `/org_id`
- a namespaced custom claim ending in `/orgId`

Optional subscription claims may use `tier`, or a namespaced claim ending in
`/tier` or `/plan`. If no tier claim is present, entitlement is read from
`organizations.subscription_tier`.

Example Auth0 Post Login Action:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://ucc-mca.example.com'
  const orgId = event.organization?.metadata?.org_id || event.user.app_metadata?.org_id
  const tier = event.organization?.metadata?.tier || event.user.app_metadata?.tier

  if (orgId) {
    api.accessToken.setCustomClaim(`${namespace}/org_id`, orgId)
  }
  if (tier) {
    api.accessToken.setCustomClaim(`${namespace}/tier`, tier)
  }
}
```

Without `org_id`, protected tenant routes fail closed. In particular,
`/api/deals` and `/api/contacts` return `403` for org-scoped access when the
token has no organization context.

## 2. Required Production Environment

`validateConfig()` blocks production startup unless these values are present:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://ucc_mca_app:...@.../ucc_mca?sslmode=require
CORS_ORIGIN=https://app.example.com
JWT_SECRET=...
STRIPE_WEBHOOK_SECRET=...
TWILIO_AUTH_TOKEN=...
SENDGRID_WEBHOOK_VERIFICATION_KEY=...
PLAID_CLIENT_ID=...
PLAID_SECRET=...
```

Set these companion values for hardened deployment behavior:

```bash
PUBLIC_URL=https://api.example.com
TRUST_PROXY=1
JWT_ORG_CLAIM=org_id
JWT_TIER_CLAIM=tier
PLAID_ENV=production
```

Plaid webhook verification currently uses Plaid's ES256/JWK flow and fetches
public verification keys through the Plaid API. The required production
prerequisites are therefore `PLAID_CLIENT_ID` and `PLAID_SECRET`, not the older
`PLAID_WEBHOOK_SECRET` shared-secret value.

## 3. Database Role and RLS

Run migrations as the schema owner or migration role. Run the API and worker
under a separate non-owner role that does not have `BYPASSRLS`; otherwise the
RLS policies from migration `018` are bypassed by Postgres.

Example role setup:

```sql
CREATE ROLE ucc_mca_app LOGIN PASSWORD 'replace-with-managed-secret';

GRANT CONNECT ON DATABASE ucc_mca TO ucc_mca_app;
GRANT USAGE ON SCHEMA public TO ucc_mca_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ucc_mca_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ucc_mca_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ucc_mca_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ucc_mca_app;
```

Verify the runtime role:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = 'ucc_mca_app';
```

Both `rolsuper` and `rolbypassrls` must be `false`, and the role must not own
the org-scoped tables.

## 4. Migration Rollout

Deploy migrations in order with `npm run db:migrate`. The active runner
normalizes historical integer rows in `schema_migrations.version` to the
zero-padded file prefixes, so an existing row like `14` is treated as `014`.

Critical rollout notes:

- `014_prospects_org_id_not_null.sql` backfills tenant-less prospects before
  making `prospects.org_id` `NOT NULL`.
- `018_row_level_security.sql` enables fail-closed tenant policies keyed on
  `app.current_org_id`.
- API/worker traffic should only run against the non-owner runtime role after
  the application code that sets `app.current_org_id` has been deployed.

## 5. Entitlement Mapping

The client-supplied `x-data-tier` header is advisory only and cannot grant
access. The server maps `organizations.subscription_tier` as follows:

| `organizations.subscription_tier` | Resolved data tier |
| --------------------------------- | ------------------ |
| `free` or unknown                 | `free-tier`        |
| `starter`                         | `starter-tier`     |
| `professional`                    | `starter-tier`     |
| `enterprise`                      | `starter-tier`     |

Confirm this coarse mapping matches product intent before enabling paid-tier
features in production.
