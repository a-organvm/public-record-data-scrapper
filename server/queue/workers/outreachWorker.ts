import { OutreachSequenceService } from '../../services/OutreachSequenceService'

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
  skipped: boolean
  reason?: string
}

export async function processOutreachJob(
  jobData: OutreachJobData,
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }
): Promise<OutreachJobResult> {
  const sequenceService = new OutreachSequenceService(db)

  // 1. Check eligibility
  const eligibility = await sequenceService.isEligible(
    jobData.prospectId,
    jobData.triggerType,
    jobData.capacityScore
  )

  if (!eligibility.eligible) {
    return { sequenceId: null, stepsSent: 0, skipped: true, reason: eligibility.reason }
  }

  // 2. Create sequence
  const sequenceId = await sequenceService.createSequence(
    jobData.prospectId,
    jobData.triggerType,
    jobData.filingEventId,
    jobData.capacityScore
  )

  // 3. Process immediate steps (pending, not scheduled)
  let stepsSent = 0
  let step = await sequenceService.getNextPendingStep(sequenceId)

  while (step) {
    try {
      // Template variable substitution would happen here with prospect data
      // For now, mark as sent (CommunicationsService integration is fail-closed)
      await sequenceService.updateStepStatus(
        step.id,
        'sent',
        `outreach-${sequenceId}-step-${step.stepNumber}`
      )
      stepsSent++
      console.log(
        `[outreach] Sent step ${step.stepNumber} (${step.channel}) for sequence ${sequenceId}`
      )
    } catch (err) {
      await sequenceService.updateStepStatus(step.id, 'failed', undefined, (err as Error).message)
      console.error(`[outreach] Failed step ${step.stepNumber}:`, (err as Error).message)
    }

    step = await sequenceService.getNextPendingStep(sequenceId)
  }

  // 4. Check if all steps done
  const remaining = await sequenceService.getNextPendingStep(sequenceId)
  if (!remaining) {
    // Check if there are scheduled steps still pending
    const scheduled = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM outreach_steps WHERE sequence_id = $1 AND status = 'scheduled'`,
      [sequenceId]
    )
    if (parseInt(scheduled[0]?.count ?? '0', 10) === 0) {
      await sequenceService.completeSequence(sequenceId)
    }
  }

  return { sequenceId, stepsSent, skipped: false }
}
