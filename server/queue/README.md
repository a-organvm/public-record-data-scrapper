# Job Queue System

This directory contains the BullMQ-based job queue system for background processing and scheduled tasks.

## Architecture

```
server/queue/
├── connection.ts       # Redis connection manager
├── queues.ts          # Queue definitions and initialization
├── scheduler.ts       # Job scheduler for recurring tasks
├── workers/           # Worker implementations
│   ├── ingestionWorker.ts   # UCC data ingestion
│   ├── enrichmentWorker.ts  # Data enrichment
│   └── healthWorker.ts      # Health score calculations
└── README.md
```

## Queues

### 1. UCC Ingestion Queue (`ucc-ingestion`)

Processes state-by-state UCC filing ingestion from public records portals.

**Job Data:**

```typescript
{
  state: string           // 2-letter state code (e.g., "NY", "CA")
  startDate?: string      // Optional start date for date range
  endDate?: string        // Optional end date for date range
  batchSize?: number      // Records per batch (default: 1000)
  dataTier?: 'free-tier' | 'starter-tier'
  uccProvider?: 'csc' | 'ctcorp' | 'lexisnexis' | 'unconfigured'
}
```

UCC provider selection is resolved per tier when the job is enqueued using
`FREE_TIER_*` / `STARTER_TIER_*` credentials. The resolved `uccProvider` is
stored with the job payload for debugging.

**Schedule:** Daily at 2:00 AM for the production-backed states that currently have a real ingestion strategy wired

**Concurrency:** 2 (processes 2 states simultaneously)

**Rate Limit:** 10 jobs per minute

### 2. Data Enrichment Queue (`data-enrichment`)

Enriches prospect data with external signals (growth indicators, health scores, etc.)

**Job Data:**

```typescript
{
  prospectIds: string[]   // Array of prospect UUIDs (max 100)
  force?: boolean         // Force re-enrichment of already enriched prospects
  dataTier?: 'free-tier' | 'starter-tier'
}
```

**Schedule:** Every 6 hours for stale/unenriched prospects (batches of 50)

**Concurrency:** 5 (processes 5 batches simultaneously)

**Rate Limit:** 50 jobs per minute

### 3. Health Score Queue (`health-scores`)

Calculates health scores for portfolio companies based on various factors.

**Job Data:**

```typescript
{
  portfolioCompanyId?: string   // Optional specific company ID
  batchSize?: number            // Companies per batch (default: 50)
  dataTier?: 'free-tier' | 'starter-tier'
}
```

**Schedule:** Every 12 hours for companies with stale health scores

**Concurrency:** 3 (processes 3 batches simultaneously)

**Rate Limit:** 30 jobs per minute

## Running Workers

### Development Mode

Run workers with auto-reload on code changes:

```bash
npm run dev:worker
```

Run everything (frontend + server + workers):

```bash
npm run dev:all
```

### Production Mode

Build and run workers:

```bash
npm run build:server
npm run start:worker
```

## API Endpoints

### Trigger Jobs Manually

**POST /api/jobs/ingestion**

```bash
curl -X POST http://localhost:3000/api/jobs/ingestion \
  -H "Content-Type: application/json" \
  -d '{
    "state": "NY",
    "batchSize": 1000
  }'
```

**POST /api/jobs/enrichment**

```bash
curl -X POST http://localhost:3000/api/jobs/enrichment \
  -H "Content-Type: application/json" \
  -d '{
    "prospectIds": ["uuid-1", "uuid-2"],
    "force": false
  }'
```

**POST /api/jobs/health-scores**

```bash
curl -X POST http://localhost:3000/api/jobs/health-scores \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioCompanyId": "optional-uuid",
    "batchSize": 50
  }'
```

### Monitor Jobs

**GET /api/jobs/:jobId**

Get detailed status of a specific job:

```bash
curl http://localhost:3000/api/jobs/{job-id}
```

Response:

```json
{
  "jobId": "123",
  "queueName": "data-enrichment",
  "status": "completed",
  "progress": 100,
  "data": { "prospectIds": ["..."] },
  "returnvalue": { "successful": 50, "failed": 0 },
  "processedOn": 1234567890,
  "finishedOn": 1234567900
}
```

**GET /api/jobs/queues/stats**

Get statistics for all queues:

```bash
curl http://localhost:3000/api/jobs/queues/stats
```

Response:

```json
{
  "queues": [
    {
      "queue": "ucc-ingestion",
      "waiting": 5,
      "active": 2,
      "completed": 150,
      "failed": 3,
      "delayed": 0,
      "total": 160
    }
  ]
}
```

**GET /api/jobs/queues/:queueName?status=waiting&limit=20**

List jobs in a specific queue:

```bash
curl "http://localhost:3000/api/jobs/queues/data-enrichment?status=active&limit=10"
```

Query Parameters:

- `status`: `waiting`, `active`, `completed`, `failed`, `delayed` (default: `waiting`)
- `limit`: Number of jobs to return (default: 20)

**DELETE /api/jobs/:jobId**

Remove a job from the queue:

```bash
curl -X DELETE http://localhost:3000/api/jobs/{job-id}
```

## Scheduler

The job scheduler automatically queues recurring jobs:

### UCC Ingestion

- **Frequency:** Daily at 2:00 AM
- **States:** NY, CA, TX, FL, IL, PA, OH, GA, NC, MI
- **Action:** Creates one ingestion job per state

### Enrichment Refresh

- **Frequency:** Every 6 hours
- **Target:** Prospects with no enrichment data or data older than 7 days
- **Batch Size:** 50 prospects per job
- **Limit:** 500 prospects per run

### Health Score Updates

- **Frequency:** Every 12 hours
- **Target:** Portfolio companies with stale health scores (>12 hours old)
- **Batch Size:** 50 companies per job

## Job Retry Strategy

All queues use exponential backoff for failed jobs:

- **Attempts:** 3 retries
- **Backoff:** 2 seconds × 2^attempt
  - 1st retry: 2 seconds
  - 2nd retry: 4 seconds
  - 3rd retry: 8 seconds

## Job Cleanup

Completed and failed jobs are automatically removed based on retention policies:

**Completed Jobs:**

- Keep last 100 jobs
- Or jobs from last 7 days
- Whichever is greater

**Failed Jobs:**

- Keep last 500 jobs
- Or jobs from last 30 days
- Whichever is greater

## Redis Configuration

Required environment variables:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password-here
```

## Worker Process Management

### Process Separation

For production deployments, run workers as separate processes from the API server:

1. **API Server:** Handles HTTP requests and queues jobs

   ```bash
   npm run start:server
   ```

2. **Worker Process:** Processes jobs from queues
   ```bash
   npm run start:worker
   ```

This allows independent scaling:

- Scale API servers horizontally for traffic
- Scale workers horizontally for job processing

### Graceful Shutdown

Both server and worker processes handle SIGTERM and SIGINT signals:

```bash
# Gracefully stop worker
kill -SIGTERM <worker-pid>

# Gracefully stop server
kill -SIGTERM <server-pid>
```

Shutdown sequence:

1. Stop accepting new jobs
2. Complete active jobs (up to 30 seconds)
3. Close queue connections
4. Disconnect from Redis
5. Disconnect from database
6. Exit process

## Monitoring and Debugging

### Enable Debug Logging

For BullMQ debug logs:

```bash
DEBUG=bull:* npm run dev:worker
```

### Common Issues

**Issue: Jobs stuck in waiting**

- Check Redis connection
- Verify worker process is running
- Check worker concurrency limits

**Issue: Jobs failing repeatedly**

- Check database connectivity
- Verify external API credentials (Phase 2)
- Review job error logs in failed jobs queue

**Issue: High memory usage**

- Reduce worker concurrency
- Decrease batch sizes
- Check for memory leaks in worker code

## Phase 2 Integration

In Phase 2, workers will be enhanced with:

- Real UCC portal scrapers (replacing simulated ingestion)
- External API integrations for enrichment:
  - SEC API for company filings
  - OSHA API for safety violations
  - USPTO API for patent data
  - Census Bureau Business API
  - SAM.gov contract awards
- Sentiment analysis for health scoring
- Email notifications for job failures

## Phase 3 Enhancements (Current)

✅ BullMQ queue infrastructure
✅ Redis connection pooling
✅ Three worker types (ingestion, enrichment, health)
✅ Job scheduler with recurring tasks
✅ Job monitoring API endpoints
✅ Graceful shutdown handling
✅ Retry strategies and exponential backoff
✅ Job cleanup and retention policies

## Future Improvements

- Job priority queues for urgent processing
- Dead letter queues for permanently failed jobs
- Job metrics and Prometheus integration
- Web UI for queue monitoring (Bull Board)
- Rate limiting per external API provider
- Job chaining and workflows
- Webhook notifications on job completion
