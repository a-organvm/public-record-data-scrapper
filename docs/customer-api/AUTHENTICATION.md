# API Authentication

The UCC-MCA Intelligence API uses signed API keys to authenticate requests. These keys are JWT bearer tokens issued during onboarding or by `POST /api/auth/api-keys`.

## Authentication Flow

To authenticate your requests, include the `Authorization` header with the `Bearer` scheme:

```http
Authorization: Bearer <your_jwt_token>
```

You can also send the issued key with:

```http
X-API-Key: <your_api_key>
```

## Obtaining a Token

Depending on your subscription tier and setup, you may obtain keys via your platform dashboard, onboarding, or the operator issuance endpoint:

```bash
curl -X POST "https://api.your-domain.com/api/auth/api-keys" \
  -H "X-API-Key-Issuer-Secret: $API_KEY_ISSUER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId":"user_123","orgId":"org_456","role":"user","expiresIn":"30d"}'
```

`API_KEY_ISSUER_SECRET` is an operator-only secret and should never be embedded in customer applications.

## Token Expiration

* **Issued API keys:** Default to 30 days unless the operator sets a shorter `expiresIn` or `API_KEY_EXPIRES_IN`.
* **External access tokens:** Typically expire in 1 hour when an identity provider is used.

Make sure your integration handles 401 Unauthorized responses to seamlessly refresh tokens or prompt for re-authentication.

## Example Request

**cURL**
```bash
curl -X GET "https://api.your-domain.com/api/prospects" \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json"
```

## Security Best Practices

* **Always use HTTPS:** Never send your token over unencrypted HTTP.
* **Store tokens securely:** Keep tokens out of version control and public repositories. Use secure environment variables or a secrets manager.
* **Respect Token Lifetimes:** Build retry mechanisms that intercept 401 errors, refresh the token, and replay the original request.
