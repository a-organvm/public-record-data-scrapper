# Environment Variables

This document describes all environment variables used by the UCC-MCA Intelligence Platform.

## Required Variables

### Production Required

These variables MUST be set in production environments:

| Variable       | Description                                                   | Example                                             |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `JWT_SECRET`   | Secret key for JWT signing. Must be cryptographically secure. | `a-very-long-random-string-here`                    |
| `DATABASE_URL` | PostgreSQL connection URL                                     | `postgresql://user:pass@host:5432/dbname`           |
| `CORS_ORIGIN`  | Comma-separated list of allowed origins                       | `https://app.example.com,https://admin.example.com` |
| `REDIS_URL`    | Redis connection URL                                          | `redis://:password@host:6379`                       |

## Server Configuration

| Variable    | Description                               | Default                      | Required |
| ----------- | ----------------------------------------- | ---------------------------- | -------- |
| `PORT`      | Server port                               | `3000`                       | No       |
| `HOST`      | Server host                               | `0.0.0.0`                    | No       |
| `NODE_ENV`  | Environment (development/production/test) | `development`                | No       |
| `LOG_LEVEL` | Logging level (debug/info/warn/error)     | `info` (prod), `debug` (dev) | No       |

## Database Configuration

| Variable             | Description                  | Default                                        | Required   |
| -------------------- | ---------------------------- | ---------------------------------------------- | ---------- |
| `DATABASE_URL`       | PostgreSQL connection URL    | `postgresql://localhost:5432/ucc_intelligence` | Yes (prod) |
| `DB_MAX_CONNECTIONS` | Maximum connection pool size | `20`                                           | No         |

### Database URL Format

```
postgresql://[user]:[password]@[host]:[port]/[database]?[options]
```

Options:

- `sslmode=require` - Require SSL connection (recommended for production)
- `connect_timeout=10` - Connection timeout in seconds

## Redis Configuration

| Variable               | Description                              | Default                  | Required   |
| ---------------------- | ---------------------------------------- | ------------------------ | ---------- |
| `REDIS_URL`            | Redis connection URL                     | `redis://localhost:6379` | Yes (prod) |
| `USE_REDIS_RATE_LIMIT` | Force Redis rate limiting in development | `false`                  | No         |

### Redis URL Format

```
redis://[:password@]host[:port]
rediss://[:password@]host[:port]  # TLS connection
```

## Authentication

| Variable              | Description                   | Default | Required   |
| --------------------- | ----------------------------- | ------- | ---------- |
| `JWT_SECRET`          | Secret key for signing JWTs   | N/A     | Yes (prod) |
| `AUTH0_DOMAIN`        | Auth0 domain (if using Auth0) | -       | No         |
| `AUTH0_CLIENT_ID`     | Auth0 client ID               | -       | No         |
| `AUTH0_CLIENT_SECRET` | Auth0 client secret           | -       | No         |
| `AUTH0_AUDIENCE`      | Auth0 API audience            | -       | No         |

## CORS Configuration

| Variable      | Description                     | Default                                             | Required   |
| ------------- | ------------------------------- | --------------------------------------------------- | ---------- |
| `CORS_ORIGIN` | Comma-separated allowed origins | `http://localhost:5173,http://localhost:5000` (dev) | Yes (prod) |

Example:

```bash
CORS_ORIGIN=https://app.example.com,https://admin.example.com
```

## Rate Limiting

| Variable               | Description                       | Default           | Required |
| ---------------------- | --------------------------------- | ----------------- | -------- |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `900000` (15 min) | No       |
| `RATE_LIMIT_MAX`       | Maximum requests per window       | `100`             | No       |

## External Services

### Stripe Billing

| Variable                       | Description                                          | Default | Required |
| ------------------------------ | ---------------------------------------------------- | ------- | -------- |
| `STRIPE_SECRET_KEY`            | Stripe secret key used for checkout session creation | -       | No       |
| `STRIPE_WEBHOOK_SECRET`        | Stripe webhook signing secret                        | -       | No       |
| `STRIPE_PRICE_ID_STARTER`      | Stripe price ID for the Starter plan                 | -       | No       |
| `STRIPE_PRICE_ID_PRO`          | Stripe price ID for the Pro plan                     | -       | No       |
| `STRIPE_PRICE_ID_PROFESSIONAL` | Legacy alias for the Pro plan price ID               | -       | No       |

Notes:

- `STRIPE_PRICE_ID_PRO` is preferred for new environments.
- `STRIPE_PRICE_ID_PROFESSIONAL` is still accepted as a backward-compatible alias.
- If Stripe env vars are missing, `/api/billing/signup` still records paid-plan interest in waitlist mode.

### Enrichment APIs

| Variable              | Description                             | Default | Required |
| --------------------- | --------------------------------------- | ------- | -------- |
| `CLEARBIT_API_KEY`    | Clearbit API key for company enrichment | -       | No       |
| `FULLCONTACT_API_KEY` | FullContact API key                     | -       | No       |
| `HUNTER_API_KEY`      | Hunter.io API key for email finding     | -       | No       |

### LLM Services

| Variable            | Description                            | Default  | Required |
| ------------------- | -------------------------------------- | -------- | -------- |
| `OPENAI_API_KEY`    | OpenAI API key for LLM features        | -        | No       |
| `ANTHROPIC_API_KEY` | Anthropic API key                      | -        | No       |
| `LLM_PROVIDER`      | LLM provider to use (openai/anthropic) | `openai` | No       |
| `LLM_MODEL`         | Model to use                           | `gpt-4`  | No       |

## Frontend Configuration

| Variable            | Description               | Default | Required |
| ------------------- | ------------------------- | ------- | -------- |
| `VITE_API_BASE_URL` | API base URL for frontend | `/api`  | No       |

## Security Notes

1. **Never commit secrets** - Use environment variables or secret management
2. **Use TLS in production** - Set `sslmode=require` for database, use `rediss://` for Redis
3. **Rotate secrets regularly** - Especially JWT_SECRET and API keys
4. **Limit CORS origins** - Be specific about allowed origins in production

## Example .env Files

### Development (.env.development)

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ucc_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-not-for-production
```

### Production (.env.production)

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@db.example.com:5432/ucc_prod?sslmode=require
REDIS_URL=rediss://:password@redis.example.com:6379
JWT_SECRET=<generated-secure-random-string>
CORS_ORIGIN=https://app.example.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_STARTER=price_...
STRIPE_PRICE_ID_PRO=price_...
```

### Test (.env.test)

```bash
NODE_ENV=test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ucc_test
REDIS_URL=redis://localhost:6379
JWT_SECRET=test-secret
```

## Validation

The server validates critical configuration at startup. If required variables are missing in production, the server will fail to start with a clear error message.

To test configuration validation:

```bash
NODE_ENV=production npm run dev
# Will fail if JWT_SECRET, DATABASE_URL, or CORS_ORIGIN are not set
```
