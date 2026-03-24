# SP3: Event-Triggered Outreach Automation — Design Spec

**Date:** 2026-03-23
**Priority:** P1-P2
**Depends on:** SP2 (termination detection, fresh capacity scoring, velocity — done)

---

## Goal

Wire filing events (terminations, new filings, acceleration) into automated outreach sequences via the existing CommunicationsService + Twilio/SendGrid integrations. Generate pre-call briefings so Tony's sales team walks into every call prepared.

## What Already Exists

| Component                                            | Status                                 |
| ---------------------------------------------------- | -------------------------------------- |
| CommunicationsService (email, SMS, call)             | Wired — sends immediately or schedules |
| Template engine (DB-backed, variable substitution)   | Wired                                  |
| NarrativeService (talking points, whale detection)   | Partial — interface ready              |
| Twilio SMS (`TwilioSMS.send()`)                      | Wired                                  |
| SendGrid email (`sendTransactional`, `sendTemplate`) | Wired                                  |
| Filing events (termination detection)                | Wired (SP2)                            |
| Fresh capacity scoring                               | Wired (SP2)                            |
| Filing velocity + acceleration                       | Wired (SP2)                            |
| Consent/compliance tracking                          | Partial                                |

## What's Missing

### 1. Outreach Sequence Engine

No mechanism to trigger a multi-step sequence (email → wait 2 days → SMS → wait 3 days → call) from a filing event. Need a BullMQ worker that processes filing events and dispatches outreach steps.

### 2. Pre-Call Briefing Generator

NarrativeService has the framework but no endpoint that aggregates prospect data + stack analysis + fresh capacity + velocity into a single briefing document. Tony's team needs a one-page summary before every call.

### 3. Event-to-Outreach Mapping

No configuration mapping event types to outreach templates. Need:

- Termination → "Ready for growth capital?" sequence
- New filing → "We noticed you recently secured financing" sequence
- Velocity acceleration → "Your business is growing" sequence

### 4. Outreach Queue + Worker

No background job for processing the outreach pipeline. Need a BullMQ queue that picks up filing events, applies consent checks, selects templates, and dispatches via CommunicationsService.

---

## Architecture

```
Filing Events (from SP2)
  │
  ▼
Outreach Queue (BullMQ)
  │
  ├── Consent check (skip if no opt-in)
  ├── Template selection (event type → template)
  ├── Variable population (prospect data + narrative)
  │
  ▼
Outreach Worker
  │
  ├── Step 1: Email (immediate)
  ├── Step 2: SMS (delay 2 days)
  ├── Step 3: Pre-call briefing generation
  │
  ▼
CommunicationsService (existing)
  ├── SendGrid (email)
  ├── Twilio (SMS)
  └── DB logging (communications table)
```

## Success Criteria

1. Filing event with fresh capacity score >50 triggers outreach sequence
2. Pre-call briefing available at `/api/briefing/:prospectId`
3. Outreach respects consent — no send without opt-in
4. Templates seeded for 3 event types
5. All new code has tests
