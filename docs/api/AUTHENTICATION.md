# API Authentication

This document describes the authentication system used by the UCC-MCA Intelligence Platform API.

## Overview

The API uses signed JWT bearer tokens as customer API keys. All protected endpoints require a valid signed key issued by `POST /api/auth/api-keys`.

Issued keys are verified by the shared auth middleware on the primary API endpoints.

## Authentication Flow

1. Operator sets `JWT_SECRET` and `API_KEY_ISSUER_SECRET` in the server environment.
2. Operator calls `POST /api/auth/api-keys` with `X-API-Key-Issuer-Secret`.
3. Server returns a signed customer API key.
4. Client sends that key to protected endpoints.
5. Server verifies the key signature, issuer/audience when configured, expiration, and user/org claims.

## Token Format

```
Authorization: Bearer <jwt-token>
```

Customer integrations may also send the same issued key with:

```
X-API-Key: <jwt-token>
```

## Issuing API Keys

`POST /api/auth/api-keys` is a bootstrap endpoint. It is not protected by a customer API key because it creates them; instead, it requires the operator-only `API_KEY_ISSUER_SECRET`.

Required server configuration:

| Variable                | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `JWT_SECRET`            | Signs and verifies issued API keys                  |
| `API_KEY_ISSUER_SECRET` | Authorizes calls to the issuance endpoint           |
| `API_KEY_EXPIRES_IN`    | Optional default issued-key lifetime, default `30d` |
| `JWT_ISSUER`            | Optional issuer claim enforced during verification  |
| `JWT_AUDIENCE`          | Optional audience claim enforced during verification |
| `JWT_ORG_CLAIM`         | Optional organization claim name, default `org_id`  |
| `JWT_TIER_CLAIM`        | Optional tier claim name, default `tier`            |

Generate secrets with a local secret generator and store them in `.env` for development or a secrets manager in production:

```bash
openssl rand -base64 32
```

Example issuance request:

```bash
curl -X POST "https://api.example.com/api/auth/api-keys" \
  -H "X-API-Key-Issuer-Secret: $API_KEY_ISSUER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "orgId": "org_456",
    "email": "user@example.com",
    "role": "user",
    "tier": "starter-tier",
    "expiresIn": "30d"
  }'
```

Response:

```json
{
  "apiKey": "<signed-api-key>",
  "keyId": "<key-id>",
  "tokenType": "Bearer",
  "expiresIn": "30d",
  "expiresAt": "<iso-expiration>"
}
```

### JWT Claims

| Claim       | Description                     | Required                |
| ----------- | ------------------------------- | ----------------------- |
| `sub`       | User ID                         | Yes                     |
| `org_id`    | Organization/tenant ID          | Yes for issued API keys |
| `email`     | User email                      | No                      |
| `role`      | User role (admin/user/viewer)   | No (defaults to `user`) |
| `tier`      | Subscription/data tier          | No                      |
| `token_use` | `api_key` for issued API keys   | Yes for issued API keys |
| `jti`       | Issued key id                   | Yes for issued API keys |
| `iat`       | Issued at timestamp             | Yes                     |
| `exp`       | Expiration timestamp            | Yes                     |

### Token Expiration

- **Issued API keys**: default `30d`, configurable with `API_KEY_EXPIRES_IN`
- **External JWT access tokens**: 1 hour by default
- **Refresh tokens**: 7 days, when an external identity provider is used

## Public Endpoints

The following endpoints do not require authentication:

| Endpoint                   | Description            |
| -------------------------- | ---------------------- |
| `GET /api/health`          | Basic health check     |
| `GET /api/health/live`     | Liveness probe         |
| `GET /api/health/ready`    | Readiness probe        |
| `GET /api/health/detailed` | Detailed health status |
| `GET /api/docs`            | Swagger UI             |
| `GET /status`              | Public status page     |

`POST /api/auth/api-keys` is an operator bootstrap endpoint. It requires `X-API-Key-Issuer-Secret`, not a customer API key.

## Protected Endpoints

The primary application endpoints require issued API-key or bearer-token authentication:

| Resource    | Endpoints            |
| ----------- | -------------------- |
| Prospects   | `/api/prospects/*`   |
| Competitors | `/api/competitors/*` |
| Portfolio   | `/api/portfolio/*`   |
| Enrichment  | `/api/enrichment/*`  |
| Jobs        | `/api/jobs/*`        |
| Contacts    | `/api/contacts/*`    |
| Deals       | `/api/deals/*`       |
| Competitive | `/api/competitive/*` |
| Outreach    | `/api/outreach/*`    |
| Communications | `/api/communications/*` |
| Compliance  | `/api/compliance/*`  |
| Discovery   | `/api/discovery/*`   |
| Agentic     | `/api/agentic/*`     |

## Role-Based Access Control

### Roles

| Role     | Description      | Permissions           |
| -------- | ---------------- | --------------------- |
| `admin`  | Full access      | All operations        |
| `user`   | Standard access  | CRUD on own resources |
| `viewer` | Read-only access | Read operations only  |

### Role Hierarchy

```
admin > user > viewer
```

A role includes all permissions of lower roles.

## Error Responses

### 401 Unauthorized

Returned when:

- No `Authorization` or `X-API-Key` header provided
- Invalid token format
- Token expired
- Token signature invalid

```json
{
  "error": "Unauthorized",
  "message": "Invalid token"
}
```

### 403 Forbidden

Returned when:

- User lacks required role
- User lacks permission for resource

```json
{
  "error": {
    "message": "Insufficient permissions",
    "code": "FORBIDDEN",
    "statusCode": 403
  }
}
```

## Implementation Details

### Token Validation

```typescript
// server/middleware/authMiddleware.ts
const decoded = jwt.verify(token, config.jwt.secret, {
  algorithms: ['HS256'],
  issuer: config.jwt.issuer,
  audience: config.jwt.audience
}) as JwtPayload

req.user = {
  id: decoded.sub,
  email: decoded.email,
  role: decoded.role,
  orgId: decoded.org_id,
  tier: decoded.tier
}
```

### Optional Authentication

Some endpoints support optional authentication using `optionalAuthMiddleware`:

```typescript
router.get('/public-with-user', optionalAuthMiddleware, handler)
// req.user will be set if token provided, undefined otherwise
```

### Role Requirement

```typescript
router.delete('/admin-only', authMiddleware, requireRole('admin'), handler)
// Only users with 'admin' role can access
```

## Best Practices

1. **Store tokens securely** - Use httpOnly cookies or secure storage
2. **Implement token refresh** - Don't force users to re-authenticate frequently
3. **Handle token expiration** - Refresh tokens before they expire
4. **Log out properly** - Clear tokens from storage on logout

## Example: Making Authenticated Requests

### JavaScript/TypeScript

```typescript
const response = await fetch('/api/prospects', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
})
```

### cURL

```bash
curl -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     https://api.example.com/api/prospects
```

## Security Considerations

1. **HTTPS Required** - Always use HTTPS in production
2. **Token Storage** - Never store tokens in localStorage in production
3. **CORS** - Configure CORS to restrict token usage to your domains
4. **Token Rotation** - Consider implementing token rotation for long sessions
