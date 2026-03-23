/**
 * CoverageAlertService
 *
 * Handles alerting for coverage-related events:
 * - Logs alerts to the coverage_alerts table
 * - Debounces repeated alerts (1-hour cooldown per alert type + state)
 * - Emails critical alerts when ALERT_RECIPIENT_EMAIL is configured
 */

export type CoverageStatus = 'green' | 'yellow' | 'red'

export type AlertTrigger =
  | { type: 'circuit_opened'; stateCode: string; reason: string }
  | { type: 'probe_failed'; stateCode: string; error: string }
  | { type: 'schema_change_detected'; stateCode: string }
  | { type: 'data_quality_failed'; stateCode: string; warnings: string[] }
  | { type: 'state_status_changed'; stateCode: string; from: CoverageStatus; to: CoverageStatus }

interface CoverageAlert {
  id: string
  alertType: string
  stateCode: string | null
  severity: string
  message: string
  details: Record<string, unknown> | null
  emailed: boolean
  createdAt: string
}

type DbLike = {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

type EmailSenderLike = {
  sendTransactional: (opts: {
    to: { email: string }[]
    from: { email: string; name?: string }
    subject: string
    html: string
    text?: string
  }) => Promise<{ success: boolean }>
} | null

export class CoverageAlertService {
  private cooldowns: Map<string, number> = new Map()
  private readonly COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

  constructor(
    private db: DbLike,
    private emailSender?: EmailSenderLike
  ) {}

  async handleAlert(trigger: AlertTrigger): Promise<{ logged: boolean; emailed: boolean }> {
    // 1. Check cooldown
    const cooldownKey = `${trigger.type}:${trigger.stateCode}`
    const lastAlert = this.cooldowns.get(cooldownKey)
    if (lastAlert !== undefined && Date.now() - lastAlert < this.COOLDOWN_MS) {
      return { logged: false, emailed: false }
    }

    // 2. Determine severity and message
    const severity = this.resolveSeverity(trigger)
    const message = this.resolveMessage(trigger)

    // 3. Log to database
    await this.db.query(
      `INSERT INTO coverage_alerts (alert_type, state_code, severity, message, details, emailed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [trigger.type, trigger.stateCode, severity, message, JSON.stringify(trigger), false]
    )

    // 4. Set cooldown
    this.cooldowns.set(cooldownKey, Date.now())

    // 5. Email if critical
    let emailed = false
    if (this.shouldEmail(trigger) && this.emailSender) {
      try {
        const recipient = process.env.ALERT_RECIPIENT_EMAIL
        if (recipient) {
          await this.emailSender.sendTransactional({
            to: [{ email: recipient }],
            from: { email: 'alerts@ucc-mca.com', name: 'UCC-MCA Alerts' },
            subject: `[${severity.toUpperCase()}] Coverage Alert: ${trigger.stateCode} — ${trigger.type}`,
            html: `<h2>Coverage Alert</h2><p><strong>State:</strong> ${trigger.stateCode}</p><p><strong>Type:</strong> ${trigger.type}</p><p>${message}</p>`,
            text: `Coverage Alert: ${trigger.stateCode} — ${trigger.type}\n${message}`
          })
          emailed = true
          // Update the alert record to reflect it was emailed
          await this.db.query(
            `UPDATE coverage_alerts SET emailed = true
             WHERE alert_type = $1 AND state_code = $2
               AND created_at = (
                 SELECT MAX(created_at) FROM coverage_alerts
                 WHERE alert_type = $1 AND state_code = $2
               )`,
            [trigger.type, trigger.stateCode]
          )
        }
      } catch (err) {
        console.error(`[alert] Failed to email alert:`, (err as Error).message)
      }
    }

    return { logged: true, emailed }
  }

  async getRecentAlerts(hours: number = 24): Promise<CoverageAlert[]> {
    return this.db.query<CoverageAlert>(
      `SELECT id,
              alert_type    AS "alertType",
              state_code    AS "stateCode",
              severity,
              message,
              details,
              emailed,
              created_at    AS "createdAt"
       FROM coverage_alerts
       WHERE created_at > NOW() - $1::interval
       ORDER BY created_at DESC`,
      [`${hours} hours`]
    )
  }

  clearCooldowns(): void {
    this.cooldowns.clear()
  }

  private shouldEmail(trigger: AlertTrigger): boolean {
    if (trigger.type === 'circuit_opened') return true
    if (trigger.type === 'probe_failed') return true
    if (trigger.type === 'schema_change_detected') return true
    if (trigger.type === 'state_status_changed' && trigger.to === 'red') return true
    return false
  }

  private resolveSeverity(trigger: AlertTrigger): string {
    switch (trigger.type) {
      case 'circuit_opened':
        return 'high'
      case 'probe_failed':
        return 'high'
      case 'schema_change_detected':
        return 'critical'
      case 'data_quality_failed':
        return 'medium'
      case 'state_status_changed':
        return trigger.to === 'red' ? 'high' : 'medium'
      default:
        return 'medium'
    }
  }

  private resolveMessage(trigger: AlertTrigger): string {
    switch (trigger.type) {
      case 'circuit_opened':
        return `Circuit breaker opened for ${trigger.stateCode}: ${trigger.reason}`
      case 'probe_failed':
        return `Portal probe failed for ${trigger.stateCode}: ${trigger.error}`
      case 'schema_change_detected':
        return `Schema change detected on ${trigger.stateCode} portal — scraper may need update`
      case 'data_quality_failed':
        return `Data quality check failed for ${trigger.stateCode}: ${trigger.warnings.join('; ')}`
      case 'state_status_changed':
        return `${trigger.stateCode} status changed from ${trigger.from} to ${trigger.to}`
      default:
        return 'Unknown alert'
    }
  }
}
