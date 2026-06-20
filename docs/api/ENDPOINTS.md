# API Endpoints Reference

Complete reference for all REST API endpoints in the UCC-MCA Intelligence Platform.

## Base URL

```
Development: http://localhost:3000/api
Production:  https://your-domain.com/api
```

## Authentication

All endpoints except health checks, docs, status, webhooks, and the auth bootstrap route require an issued API key. The key is a signed JWT bearer token:

```
Authorization: Bearer <token>
```

Customer clients may also use:

```
X-API-Key: <token>
```

Issue keys with `POST /api/auth/api-keys` using the operator-only `X-API-Key-Issuer-Secret` header. See [AUTHENTICATION.md](./AUTHENTICATION.md) for configuration and issuance details.

---

## Auth

### Issue API Key

```http
POST /api/auth/api-keys
```

Requires `X-API-Key-Issuer-Secret: <API_KEY_ISSUER_SECRET>`.

**Request Body:**

| Field       | Type   | Required | Description                         |
| ----------- | ------ | -------- | ----------------------------------- |
| `userId`    | string | Yes      | User identifier for the `sub` claim |
| `orgId`     | string | Yes      | Organization id for tenant binding  |
| `email`     | string | No       | User email                          |
| `role`      | string | No       | `admin`, `user`, or `viewer`        |
| `tier`      | string | No       | Subscription/data tier              |
| `expiresIn` | string | No       | Duration such as `1h`, `7d`, `30d`  |

**Response:**

```json
{
  "apiKey": "<signed-api-key>",
  "keyId": "<key-id>",
  "tokenType": "Bearer",
  "expiresIn": "30d",
  "expiresAt": "<iso-expiration>"
}
```

---

## Prospects

Manage MCA lead prospects derived from UCC filings.

### List Prospects

```http
GET /api/prospects
```

**Query Parameters:**

| Parameter    | Type    | Default          | Description                                                |
| ------------ | ------- | ---------------- | ---------------------------------------------------------- |
| `page`       | integer | 1                | Page number                                                |
| `limit`      | integer | 20               | Results per page                                           |
| `state`      | string  | -                | Filter by US state code (2 chars)                          |
| `industry`   | string  | -                | Filter by industry                                         |
| `min_score`  | integer | -                | Minimum priority score                                     |
| `max_score`  | integer | -                | Maximum priority score                                     |
| `status`     | string  | -                | Filter: `all`, `unclaimed`, `claimed`, `contacted`         |
| `sort_by`    | string  | `priority_score` | Sort field: `priority_score`, `created_at`, `company_name` |
| `sort_order` | string  | `desc`           | Sort direction: `asc`, `desc`                              |

**Response:**

```json
{
  "prospects": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### Get Prospect

```http
GET /api/prospects/:id
```

**Path Parameters:**

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `id`      | UUID | Prospect ID |

**Response:** Prospect object with all details.

### Create Prospect

```http
POST /api/prospects
```

**Request Body:**

```json
{
  "company_name": "Acme Corp",
  "state": "CA",
  "industry": "technology",
  "lien_amount": 50000,
  "filing_date": "2024-01-15T00:00:00Z"
}
```

| Field          | Type   | Required | Description                                                                                             |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `company_name` | string | Yes      | Business name                                                                                           |
| `state`        | string | Yes      | US state code (2 chars)                                                                                 |
| `industry`     | string | Yes      | One of: `restaurant`, `retail`, `construction`, `healthcare`, `manufacturing`, `services`, `technology` |
| `lien_amount`  | number | No       | UCC lien amount                                                                                         |
| `filing_date`  | string | No       | ISO 8601 datetime                                                                                       |

**Response:** `201 Created` with created prospect.

### Update Prospect

```http
PATCH /api/prospects/:id
```

**Request Body:** Partial prospect object (same fields as create, all optional).

**Response:** Updated prospect object.

### Delete Prospect

```http
DELETE /api/prospects/:id
```

**Response:** `204 No Content`

---

## Enrichment

Data enrichment and refresh operations.

### Enrich Single Prospect

```http
POST /api/enrichment/prospect
```

**Request Body:**

```json
{
  "prospect_id": "uuid-here"
}
```

**Response:**

```json
{
  "prospect_id": "uuid-here",
  "enrichment": {
    "signals_found": 3,
    "health_score_updated": true,
    "narrative_generated": true
  },
  "enriched_at": "2024-01-15T10:30:00Z"
}
```

### Batch Enrich Prospects

```http
POST /api/enrichment/batch
```

**Request Body:**

```json
{
  "prospect_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

**Constraints:** Maximum 100 prospects per batch.

**Response:**

```json
{
  "total": 3,
  "successful": 2,
  "failed": 1,
  "results": [
    { "prospect_id": "uuid-1", "success": true },
    { "prospect_id": "uuid-2", "success": true },
    { "prospect_id": "uuid-3", "success": false, "error": "..." }
  ]
}
```

### Trigger Data Refresh

```http
POST /api/enrichment/refresh
```

**Request Body:**

```json
{
  "force": false
}
```

| Field   | Type    | Default | Description                        |
| ------- | ------- | ------- | ---------------------------------- |
| `force` | boolean | false   | Force refresh even if recently run |

**Response:**

```json
{
  "triggered": true,
  "force": false,
  "job_id": "...",
  "estimated_duration_ms": 30000
}
```

### Get Enrichment Status

```http
GET /api/enrichment/status
```

**Response:**

```json
{
  "last_run": "2024-01-15T10:00:00Z",
  "next_scheduled_run": "2024-01-15T22:00:00Z",
  "prospects_enriched_today": 150,
  "avg_enrichment_time_ms": 2500
}
```

### Get Enrichment Queue

```http
GET /api/enrichment/queue
```

**Response:**

```json
{
  "pending": 25,
  "processing": 3,
  "completed_today": 150,
  "failed_today": 2
}
```

---

## Competitors

Competitor (secured party) analysis.

### List Competitors

```http
GET /api/competitors
```

**Query Parameters:**

| Parameter    | Type    | Default        | Description                                  |
| ------------ | ------- | -------------- | -------------------------------------------- |
| `page`       | integer | 1              | Page number                                  |
| `limit`      | integer | 20             | Results per page                             |
| `state`      | string  | -              | Filter by state                              |
| `sort_by`    | string  | `filing_count` | Sort: `filing_count`, `total_amount`, `name` |
| `sort_order` | string  | `desc`         | Sort direction                               |

**Response:**

```json
{
  "competitors": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

### Get Competitor

```http
GET /api/competitors/:id
```

**Response:** Competitor object with filing details.

### Get Competitor Analysis

```http
GET /api/competitors/:id/analysis
```

**Response:**

```json
{
  "competitor_id": "uuid",
  "swot": {
    "strengths": [...],
    "weaknesses": [...],
    "opportunities": [...],
    "threats": [...]
  },
  "market_position": "...",
  "trend": "growing"
}
```

### Get Competitor Statistics

```http
GET /api/competitors/stats/summary
```

**Response:**

```json
{
  "total_competitors": 150,
  "total_filings": 5000,
  "avg_deal_size": 75000,
  "top_industries": [...]
}
```

---

## Portfolio

Monitor funded portfolio companies.

### List Portfolio Companies

```http
GET /api/portfolio
```

**Query Parameters:**

| Parameter      | Type    | Default       | Description                                         |
| -------------- | ------- | ------------- | --------------------------------------------------- |
| `page`         | integer | 1             | Page number                                         |
| `limit`        | integer | 20            | Results per page                                    |
| `health_grade` | string  | -             | Filter: `A`, `B`, `C`, `D`, `F`                     |
| `sort_by`      | string  | `funded_date` | Sort: `funded_date`, `health_score`, `company_name` |
| `sort_order`   | string  | `desc`        | Sort direction                                      |

**Response:**

```json
{
  "companies": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25,
    "totalPages": 2
  }
}
```

### Get Portfolio Company

```http
GET /api/portfolio/:id
```

**Response:** Portfolio company with current health metrics.

### Get Health History

```http
GET /api/portfolio/:id/health-history
```

**Response:**

```json
{
  "company_id": "uuid",
  "history": [
    {
      "date": "2024-01-15",
      "grade": "B",
      "score": 75,
      "sentiment_trend": "stable"
    },
    ...
  ]
}
```

### Get Portfolio Statistics

```http
GET /api/portfolio/stats/summary
```

**Response:**

```json
{
  "total_companies": 25,
  "total_funded": 2500000,
  "grade_distribution": {
    "A": 5,
    "B": 10,
    "C": 6,
    "D": 3,
    "F": 1
  },
  "at_risk_count": 4
}
```

---

## Health

System health checks for monitoring and orchestration.

### Basic Health Check

```http
GET /api/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 86400,
  "environment": "production"
}
```

### Detailed Health Check

```http
GET /api/health/detailed
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 86400,
  "environment": "production",
  "services": {
    "database": "ok",
    "memory": "ok",
    "cpu": "ok"
  }
}
```

**Status Values:**

- `ok` - All systems operational
- `degraded` - Some services impaired

### Readiness Probe (Kubernetes)

```http
GET /api/health/ready
```

**Response (200 OK):**

```json
{
  "ready": true,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Response (503 Service Unavailable):**

```json
{
  "ready": false,
  "error": "Database not ready",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Liveness Probe (Kubernetes)

```http
GET /api/health/live
```

**Response:**

```json
{
  "alive": true,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE",
    "statusCode": 400
  }
}
```

See [ERROR_CODES.md](./ERROR_CODES.md) for complete error code reference.

---

## Rate Limiting

All endpoints are rate-limited. See [RATE_LIMITING.md](./RATE_LIMITING.md) for details.

**Headers included in responses:**

- `X-RateLimit-Limit` - Max requests per window
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Window reset time (ISO 8601)

---

## Pagination

List endpoints support consistent pagination:

**Request:**

```
?page=2&limit=50
```

**Response:**

```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 50,
    "total": 500,
    "totalPages": 10
  }
}
```
