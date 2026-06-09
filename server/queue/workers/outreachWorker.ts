import { Worker, Job } from 'bullmq'
import { redisConnection } from '../connection'
import { database } from '../../database/connection'
import { OutreachSequenceService } from '../../services/OutreachSequenceService'
import { CommunicationsService } from '../../services/CommunicationsService'

export interface OutreachJobData {
  filingEventId?: string
  prospectId: string
  triggerType: string
  capacityScore?: number
  triggeredBy: 'event' | 'manual'
}

export interface OutreachJobResult {
  sequenceId: string | null
  stepsSent: number
  stepsFailed: number
  skipped: boolean
  reason?: string
}

// Minimal DB surface shared with the sequence service.
type DbLike = { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

// The send surface the worker actually depends on. Kept narrow so the worker
// can be unit-tested with a mock that mirrors CommunicationsService's
// sendEmail / sendSMS contract (returns a row whose `status` reports the real
// provider outcome; throws when the provider hard-fails).
export interface OutreachSender {
  sendEmail(input: {
    orgId: string
    prospectId?: string
    contactId?: string
    toAddress: string
    subject: string
    body: string
    metadata?: Record<string, unknown>
  }): Promise<{ status: string; externalId?: string }>
  sendSMS(input: {
    orgId: string
    prospectId?: string
    contactId?: string
    toPhone: string
    body: string
    metadata?: Record<string, unknown>
  }): Promise<{ status: string; externalId?: string }>
}

// Recipient resolved for a prospect: org scope + primary contact channels.
interface ResolvedRecipient {
  orgId: string
  contactId: string | null
  email: string | null
  phone: string | null
}

/**
 * Resolve the org and primary contact channels for a prospect. The prospect's
 * org_id scopes the send (required by CommunicationsService's TCPA/DNC gate),
 * and the primary prospect_contact supplies the destination address/phone.
 */
async function resolveRecipient(db: DbLike, prospectId: string): Promise<ResolvedRecipient | null> {
  const prospectRows = await db.query<{ org_id: string | null }>(
    `SELECT org_id FROM prospects WHERE id = $1 LIMIT 1`,
    [prospectId]
  )
  const orgId = prospectRows[0]?.org_id
  if (!orgId) return null

  const contactRows = await db.query<{
    id: string
    email: string | null
    phone: string | null
    mobile: string | null
  }>(
    `SELECT c.id, c.email, c.phone, c.mobile
     FROM contacts c
     JOIN prospect_contacts pc ON pc.contact_id = c.id
     WHERE pc.prospect_id = $1 AND c.is_active = true
     ORDER BY pc.is_primary DESC, c.created_at ASC
     LIMIT 1`,
    [prospectId]
  )
  const contact = contactRows[0]

  return {
    orgId,
    contactId: contact?.id ?? null,
    email: contact?.email ?? null,
    phone: contact?.mobile ?? contact?.phone ?? null
  }
}

// A provider outcome is only treated as a success when the persisted
// communication row reports it as sent/delivered. Anything else (failed,
// pending because the provider is unconfigured, etc.) fails closed.
const SUCCESS_STATUSES = new Set(['sent', 'delivered'])

export async function processOutreachJob(
  jobData: OutreachJobData,
  db: DbLike,
  sender?: OutreachSender
): Promise<OutreachJobResult> {
  const sequenceService = new OutreachSequenceService(db)
  const communications: OutreachSender = sender ?? new CommunicationsService()

  // 1. Check eligibility
  const eligibility = await sequenceService.isEligible(
    jobData.prospectId,
    jobData.triggerType,
    jobData.capacityScore
  )

  if (!eligibility.eligible) {
    return {
      sequenceId: null,
      stepsSent: 0,
      stepsFailed: 0,
      skipped: true,
      reason: eligibility.reason
    }
  }

  // 2. Create sequence
  const sequenceId = await sequenceService.createSequence(
    jobData.prospectId,
    jobData.triggerType,
    jobData.filingEventId,
    jobData.capacityScore
  )

  // 3. Resolve the recipient once. A missing org/contact is a non-retryable
  //    data gap — every step fails closed with a named reason rather than
  //    silently "sending" to nobody.
  const recipient = await resolveRecipient(db, jobData.prospectId)

  // 4. Process immediate steps (pending, not scheduled)
  let stepsSent = 0
  let stepsFailed = 0
  let step = await sequenceService.getNextPendingStep(sequenceId)

  while (step) {
    try {
      const outcome = await sendStep(communications, recipient, jobData.prospectId, step)

      if (outcome.sent) {
        await sequenceService.updateStepStatus(step.id, 'sent', outcome.externalId)
        stepsSent++
        console.log(
          `[outreach] Sent step ${step.stepNumber} (${step.channel}) for sequence ${sequenceId}`
        )
      } else {
        // Fail closed: provider/recipient did not confirm a send.
        await sequenceService.updateStepStatus(step.id, 'failed', undefined, outcome.reason)
        stepsFailed++
        console.warn(
          `[outreach] Step ${step.stepNumber} (${step.channel}) not sent for sequence ${sequenceId}: ${outcome.reason}`
        )
      }
    } catch (err) {
      // A thrown send error (e.g. ExternalServiceError when Twilio/SendGrid is
      // unconfigured or rejects) is recorded as failed, not sent. The loop
      // continues to the next step; the queue is not retried for a per-step
      // delivery failure (matches enrichment/health per-item handling).
      await sequenceService.updateStepStatus(step.id, 'failed', undefined, (err as Error).message)
      stepsFailed++
      console.error(`[outreach] Failed step ${step.stepNumber}:`, (err as Error).message)
    }

    step = await sequenceService.getNextPendingStep(sequenceId)
  }

  // 5. Check if all immediate steps done and no scheduled steps remain
  const remaining = await sequenceService.getNextPendingStep(sequenceId)
  if (!remaining) {
    const scheduled = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM outreach_steps WHERE sequence_id = $1 AND status = 'scheduled'`,
      [sequenceId]
    )
    if (parseInt(scheduled[0]?.count ?? '0', 10) === 0) {
      await sequenceService.completeSequence(sequenceId)
    }
  }

  return { sequenceId, stepsSent, stepsFailed, skipped: false }
}

interface SendStepOutcome {
  sent: boolean
  externalId?: string
  reason?: string
}

/**
 * Dispatch a single outreach step through CommunicationsService, returning a
 * fail-closed outcome. The step is only "sent" when the underlying provider
 * reports a sent/delivered status; an unconfigured provider (which yields a
 * non-sent status or throws) results in `sent: false`.
 */
async function sendStep(
  communications: OutreachSender,
  recipient: ResolvedRecipient | null,
  prospectId: string,
  step: {
    id: string
    stepNumber: number
    channel: string
    subject: string | null
    body: string | null
  }
): Promise<SendStepOutcome> {
  if (!recipient) {
    return { sent: false, reason: 'No org/contact resolved for prospect — cannot send' }
  }

  const body = step.body ?? ''
  if (!body) {
    return { sent: false, reason: 'Step has no body to send' }
  }

  const metadata = { source: 'outreach-sequence', stepNumber: step.stepNumber }

  if (step.channel === 'email') {
    if (!recipient.email) {
      return { sent: false, reason: 'No contact email on file for prospect' }
    }
    const result = await communications.sendEmail({
      orgId: recipient.orgId,
      prospectId,
      contactId: recipient.contactId ?? undefined,
      toAddress: recipient.email,
      subject: step.subject ?? '(no subject)',
      body,
      metadata
    })
    return interpretResult(result, 'email')
  }

  if (step.channel === 'sms') {
    if (!recipient.phone) {
      return { sent: false, reason: 'No contact phone on file for prospect' }
    }
    const result = await communications.sendSMS({
      orgId: recipient.orgId,
      prospectId,
      contactId: recipient.contactId ?? undefined,
      toPhone: recipient.phone,
      body,
      metadata
    })
    return interpretResult(result, 'sms')
  }

  // 'call' / 'briefing' channels are not auto-dispatched by this worker.
  return { sent: false, reason: `Channel '${step.channel}' is not auto-dispatchable` }
}

function interpretResult(
  result: { status: string; externalId?: string },
  channel: string
): SendStepOutcome {
  if (SUCCESS_STATUSES.has(result.status)) {
    return { sent: true, externalId: result.externalId }
  }
  return {
    sent: false,
    reason: `${channel} provider returned status '${result.status}' (not sent — provider may be unconfigured)`
  }
}

export function createOutreachWorker() {
  const { client } = redisConnection.connect()

  const worker = new Worker<OutreachJobData, OutreachJobResult>(
    'outreach',
    (job: Job<OutreachJobData>) => processOutreachJob(job.data, database),
    {
      connection: client,
      concurrency: 3,
      limiter: {
        max: 30,
        duration: 60000
      }
    }
  )

  worker.on('completed', (job, returnvalue) => {
    console.log(`[Outreach Worker] Job ${job.id} completed:`, returnvalue)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Outreach Worker] Job ${job?.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error('[Outreach Worker] Worker error:', err)
  })

  console.log('✓ Outreach worker started')

  return worker
}
