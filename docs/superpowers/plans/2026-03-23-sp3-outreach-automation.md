# SP3: Event-Triggered Outreach Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect filing events to automated outreach sequences with pre-call briefings, consent gating, and multi-step email/SMS sequences via existing Twilio + SendGrid integrations.

**Architecture:** New BullMQ outreach queue processes filing events through consent check → template selection → variable population → CommunicationsService dispatch. Pre-call briefing aggregates prospect data from all SP1+SP2 services into a single API endpoint.

**Tech Stack:** TypeScript, Express 5, BullMQ, PostgreSQL, SendGrid, Twilio, Vitest

---

## File Structure

### New Files

| File                                                        | Responsibility                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `database/migrations/012_outreach_sequences.sql`            | Outreach sequences + step tracking tables                  |
| `database/migrations/012_down.sql`                          | Rollback                                                   |
| `server/services/OutreachSequenceService.ts`                | Sequence engine: event → template → dispatch               |
| `server/services/PreCallBriefingService.ts`                 | Aggregate prospect data into one-page briefing             |
| `server/config/outreachTemplates.ts`                        | Seed templates for 3 event types                           |
| `server/queue/workers/outreachWorker.ts`                    | Process outreach queue, dispatch via CommunicationsService |
| `server/routes/outreach.ts`                                 | API: briefings, manual triggers, sequence management       |
| `server/__tests__/services/OutreachSequenceService.test.ts` | Tests                                                      |
| `server/__tests__/services/PreCallBriefingService.test.ts`  | Tests                                                      |
| `server/__tests__/queue/workers/outreachWorker.test.ts`     | Tests                                                      |
| `server/__tests__/routes/outreach.test.ts`                  | Tests                                                      |

### Modified Files

| File                                                 | Change                                         |
| ---------------------------------------------------- | ---------------------------------------------- |
| `server/queue/queues.ts`                             | Add outreach queue                             |
| `server/queue/scheduler.ts`                          | Schedule outreach processing (every 15 min)    |
| `server/queue/workers/terminationDetectionWorker.ts` | Queue outreach job after creating filing event |
| `server/index.ts`                                    | Mount /api/outreach routes                     |
| `database/schema.sql`                                | Append new tables                              |
| `server/__tests__/setup.ts`                          | Add new tables to truncation                   |

---

## Task 1: Database Migration — Outreach Sequences

**Files:**

- Create: `database/migrations/012_outreach_sequences.sql`
- Create: `database/migrations/012_down.sql`

```sql
-- 012_outreach_sequences.sql

-- Outreach sequences triggered by filing events
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  filing_event_id UUID REFERENCES filing_events(id) ON DELETE SET NULL,
  trigger_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'failed')),
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  fresh_capacity_score INTEGER,
  metadata JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sequences_prospect ON outreach_sequences(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sequences_status ON outreach_sequences(status) WHERE status IN ('pending', 'active');

-- Individual steps within a sequence
CREATE TABLE IF NOT EXISTS outreach_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms', 'call', 'briefing')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'sent', 'delivered', 'failed', 'skipped')),
  template_key VARCHAR(100),
  subject TEXT,
  body TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  external_id VARCHAR(200),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON outreach_steps(sequence_id, step_number);
CREATE INDEX IF NOT EXISTS idx_steps_scheduled ON outreach_steps(scheduled_for) WHERE status = 'scheduled';

-- Pre-call briefings (cached, regenerated on demand)
CREATE TABLE IF NOT EXISTS pre_call_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE(prospect_id)
);
CREATE INDEX IF NOT EXISTS idx_briefings_prospect ON pre_call_briefings(prospect_id);
```

Rollback drops all three tables. Commit as migration 012.

---

## Task 2: Outreach Template Configuration

**Files:**

- Create: `server/config/outreachTemplates.ts`

Define seed templates for 3 event types:

```typescript
export interface OutreachTemplate {
  key: string
  triggerType: string
  channel: 'email' | 'sms'
  subject?: string // email only
  body: string // supports {{variable}} substitution
  delayMinutes: number // delay from sequence start
}

export const OUTREACH_SEQUENCES: Record<string, OutreachTemplate[]> = {
  termination: [
    {
      key: 'termination-email-1',
      triggerType: 'termination',
      channel: 'email',
      subject: '{{companyName}} — Fresh capital capacity available',
      body: `Hi {{contactName}},\n\nWe noticed that {{companyName}} recently completed a financing obligation. Congratulations on that milestone.\n\nWith your current position, you may have capacity for growth capital. We specialize in fast, flexible funding for businesses like yours.\n\nWould you be open to a quick conversation this week?\n\nBest,\n{{senderName}}`,
      delayMinutes: 0
    },
    {
      key: 'termination-sms-1',
      triggerType: 'termination',
      channel: 'sms',
      body: `Hi {{contactName}}, this is {{senderName}} from {{senderCompany}}. I noticed {{companyName}} recently freed up financing capacity. Would you be open to a quick call about growth capital options? Reply STOP to opt out.`,
      delayMinutes: 2880 // 2 days
    }
  ],
  new_filing: [
    {
      key: 'new-filing-email-1',
      triggerType: 'new_filing',
      channel: 'email',
      subject: "{{companyName}} — We see you're growing",
      body: `Hi {{contactName}},\n\nWe noticed {{companyName}} recently secured new financing — that usually means things are moving in the right direction.\n\nIf you\'re looking for additional capital to fuel that growth, we offer competitive terms with fast funding.\n\nHappy to discuss when it makes sense for you.\n\nBest,\n{{senderName}}`,
      delayMinutes: 0
    }
  ],
  acceleration: [
    {
      key: 'acceleration-email-1',
      triggerType: 'acceleration',
      channel: 'email',
      subject: "{{companyName}} — Growing fast? Let's talk capital.",
      body: `Hi {{contactName}},\n\nOur data shows {{companyName}} has been expanding rapidly. Businesses in growth mode often benefit from flexible working capital.\n\nI\'d love to share how we help companies like yours fund expansion without slowing down.\n\nOpen to a quick call?\n\nBest,\n{{senderName}}`,
      delayMinutes: 0
    }
  ]
}

export const MINIMUM_CAPACITY_SCORE = 50 // Don't trigger outreach below this score
export const SEQUENCE_COOLDOWN_DAYS = 30 // Don't re-trigger for same prospect within 30 days
```

No tests needed for pure config. Commit separately.

---

## Task 3: OutreachSequenceService

**Files:**

- Create: `server/services/OutreachSequenceService.ts`
- Create: `server/__tests__/services/OutreachSequenceService.test.ts`

Key methods:

```typescript
export class OutreachSequenceService {
  constructor(private db: DatabaseLike) {}

  // Check if prospect is eligible for outreach (consent + cooldown + score)
  async isEligible(
    prospectId: string,
    triggerType: string
  ): Promise<{ eligible: boolean; reason?: string }>

  // Create a new sequence from a filing event
  async createSequence(
    prospectId: string,
    triggerType: string,
    filingEventId?: string,
    capacityScore?: number
  ): Promise<string>
  // Returns sequence ID. Creates outreach_sequences row + outreach_steps for each template step.

  // Get next pending step for a sequence
  async getNextStep(sequenceId: string): Promise<OutreachStep | null>

  // Mark a step as sent/failed
  async updateStepStatus(
    stepId: string,
    status: string,
    externalId?: string,
    error?: string
  ): Promise<void>

  // Complete a sequence
  async completeSequence(sequenceId: string): Promise<void>

  // Get active sequences for a prospect
  async getActiveSequences(prospectId: string): Promise<OutreachSequence[]>
}
```

Tests: eligibility checks (consent, cooldown, score threshold), sequence creation with correct steps, step progression, completion.

---

## Task 4: PreCallBriefingService

**Files:**

- Create: `server/services/PreCallBriefingService.ts`
- Create: `server/__tests__/services/PreCallBriefingService.test.ts`

```typescript
export interface PreCallBriefing {
  prospectId: string
  generatedAt: string
  companyName: string
  state: string
  industry: string | null
  summary: string
  stackAnalysis: {
    activeFilings: number
    totalHistorical: number
    estimatedPosition: number
    isOverStacked: boolean
    knownCompetitors: string[]
  }
  freshCapacity: {
    score: number
    recentTerminations: number
    daysSinceLastTermination: number | null
  }
  velocity: {
    trend30d: string
    filings30d: number
    trend90d: string
  }
  talkingPoints: string[]
  riskFactors: string[]
  recommendedApproach: string
}

export class PreCallBriefingService {
  constructor(private db: DatabaseLike) {}

  async generateBriefing(prospectId: string): Promise<PreCallBriefing>
  // Queries: prospects, ucc_filings, filing_events, filing_velocity_metrics
  // Calls: FreshCapacityService.computeForProspect
  // Aggregates into single briefing object
  // Caches in pre_call_briefings table (24h TTL)

  async getCachedBriefing(prospectId: string): Promise<PreCallBriefing | null>
  // Returns cached if not expired, null otherwise
}
```

Tests: briefing aggregation, caching behavior, expired cache regeneration.

---

## Task 5: Outreach Worker

**Files:**

- Create: `server/queue/workers/outreachWorker.ts`
- Create: `server/__tests__/queue/workers/outreachWorker.test.ts`

```typescript
export interface OutreachJobData {
  filingEventId?: string
  prospectId: string
  triggerType: string
  capacityScore?: number
  triggeredBy: 'event' | 'manual'
}

export async function processOutreachJob(
  db: DatabaseLike,
  sequenceService: OutreachSequenceService,
  commsService: { send: (channel: string, input: unknown) => Promise<unknown> } | null
): Promise<{ sequenceId: string | null; stepsSent: number; skipped: boolean; reason?: string }>
```

Flow:

1. Check eligibility via OutreachSequenceService
2. If not eligible, return `{skipped: true, reason}`
3. Create sequence
4. Process immediate steps (delayMinutes === 0)
5. Schedule delayed steps
6. For each step: populate template variables, send via CommunicationsService, update step status
7. Return results

Tests: full flow, eligibility skip, template variable population, send failure handling.

---

## Task 6: Outreach API Routes

**Files:**

- Create: `server/routes/outreach.ts`
- Create: `server/__tests__/routes/outreach.test.ts`

Endpoints:

```
GET  /api/outreach/briefing/:prospectId     — Generate/return pre-call briefing
POST /api/outreach/trigger/:prospectId      — Manually trigger outreach for a prospect
GET  /api/outreach/sequences/:prospectId    — List active sequences for a prospect
GET  /api/outreach/sequences/:id/steps      — List steps for a sequence
POST /api/outreach/sequences/:id/cancel     — Cancel an active sequence
```

Mount behind auth middleware.

---

## Task 7: Wire Into Termination Detection + Scheduler

**Files:**

- Modify: `server/queue/queues.ts` — add outreach queue
- Modify: `server/queue/scheduler.ts` — schedule outreach processing every 15 min
- Modify: `server/queue/workers/terminationDetectionWorker.ts` — queue outreach job after creating filing event
- Modify: `server/index.ts` — mount /api/outreach
- Modify: `server/__tests__/setup.ts` — add new tables

---

## Task 8: Final Verification

Run all tests, ESLint, verify no regressions.

---

## Summary

| Task      | Description                     | New Tests         |
| --------- | ------------------------------- | ----------------- |
| 1         | Database migration 012          | —                 |
| 2         | Outreach template config        | —                 |
| 3         | OutreachSequenceService         | ~8                |
| 4         | PreCallBriefingService          | ~6                |
| 5         | Outreach worker                 | ~7                |
| 6         | Outreach API routes             | ~8                |
| 7         | Wire into detection + scheduler | 0 (regression)    |
| 8         | Final verification              | 0                 |
| **Total** | **8 tasks**                     | **~29 new tests** |
