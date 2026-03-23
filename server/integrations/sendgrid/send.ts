/**
 * SendGrid Email Sending
 *
 * Provides email sending capabilities:
 * - Transactional emails
 * - Template-based emails
 * - Bulk sending
 * - Attachment handling
 *
 * Webhook endpoints to implement:
 * - POST /api/webhooks/sendgrid/events - Delivery, open, click events
 * - POST /api/webhooks/sendgrid/bounce - Bounce handling
 * - POST /api/webhooks/sendgrid/unsubscribe - Unsubscribe handling
 */

import { SendGridClient } from './client'

export interface EmailRecipient {
  email: string
  name?: string
}

export interface EmailAttachment {
  name: string
  url?: string
  content?: string // Base64 encoded
  type?: string
  size?: number
  mimeType?: string
}

export interface SendTransactionalOptions {
  to: string | string[] | EmailRecipient | EmailRecipient[]
  cc?: string | string[] | EmailRecipient | EmailRecipient[]
  bcc?: string | string[] | EmailRecipient | EmailRecipient[]
  from?: { email?: string; name?: string }
  replyTo?: { email: string; name?: string }
  subject: string
  text?: string
  html?: string
  attachments?: EmailAttachment[]
  categories?: string[]
  customArgs?: Record<string, string>
  sendAt?: Date
  trackingSettings?: {
    clickTracking?: boolean
    openTracking?: boolean
    subscriptionTracking?: boolean
  }
}

export interface SendTemplateOptions {
  to: string | string[] | EmailRecipient | EmailRecipient[]
  cc?: string | string[] | EmailRecipient | EmailRecipient[]
  bcc?: string | string[] | EmailRecipient | EmailRecipient[]
  from?: { email?: string; name?: string }
  replyTo?: { email: string; name?: string }
  templateId: string
  dynamicTemplateData?: Record<string, unknown>
  attachments?: EmailAttachment[]
  categories?: string[]
  customArgs?: Record<string, string>
  sendAt?: Date
}

export interface SendBulkOptions {
  personalizations: Array<{
    to: EmailRecipient[]
    cc?: EmailRecipient[]
    bcc?: EmailRecipient[]
    subject?: string
    dynamicTemplateData?: Record<string, unknown>
  }>
  from?: { email?: string; name?: string }
  subject?: string
  templateId?: string
  text?: string
  html?: string
  categories?: string[]
}

export interface EmailSendResult {
  messageId: string
  status: 'accepted' | 'queued' | 'failed'
  errors?: string[]
}

export interface WebhookEvent {
  email: string
  timestamp: number
  event: SendGridEventType
  sg_event_id: string
  sg_message_id: string
  category?: string[]
  reason?: string
  url?: string
  useragent?: string
  ip?: string
}

export type SendGridEventType =
  | 'processed'
  | 'deferred'
  | 'delivered'
  | 'bounce'
  | 'dropped'
  | 'open'
  | 'click'
  | 'spamreport'
  | 'unsubscribe'
  | 'group_unsubscribe'
  | 'group_resubscribe'

/**
 * SendGridSend provides email sending capabilities.
 */
export class SendGridSend {
  private client: SendGridClient

  constructor(client: SendGridClient) {
    this.client = client
  }

  /**
   * Send a transactional email
   */
  async sendTransactional(options: SendTransactionalOptions): Promise<EmailSendResult> {
    // Validate recipients
    const toRecipients = this.normalizeRecipients(options.to)
    if (toRecipients.length === 0) {
      throw new Error('At least one recipient is required')
    }

    // Validate content
    if (!options.text && !options.html) {
      throw new Error('Either text or html content is required')
    }

    // Build mail data
    const mailData = {
      personalizations: [
        {
          to: toRecipients,
          cc: options.cc ? this.normalizeRecipients(options.cc) : undefined,
          bcc: options.bcc ? this.normalizeRecipients(options.bcc) : undefined
        }
      ],
      from: this.client.buildSender(options.from),
      reply_to: options.replyTo,
      subject: options.subject,
      content: this.buildContent(options.text, options.html),
      attachments: options.attachments ? this.formatAttachments(options.attachments) : undefined,
      categories: options.categories,
      custom_args: options.customArgs,
      send_at: options.sendAt ? Math.floor(options.sendAt.getTime() / 1000) : undefined,
      tracking_settings: options.trackingSettings
        ? {
            click_tracking:
              options.trackingSettings.clickTracking !== false ? { enable: true } : undefined,
            open_tracking:
              options.trackingSettings.openTracking !== false ? { enable: true } : undefined,
            subscription_tracking: options.trackingSettings.subscriptionTracking
              ? { enable: true }
              : undefined
          }
        : undefined,
      mail_settings: this.client.isSandboxMode() ? { sandbox_mode: { enable: true } } : undefined
    }

    // Send via API
    const response = await this.client.request<{ messageId: string; status: string }>(
      'POST',
      '/v3/mail/send',
      mailData
    )

    if (!response.success) {
      return {
        messageId: '',
        status: 'failed',
        errors: [response.error?.message || 'Unknown error']
      }
    }

    return {
      messageId: response.data?.messageId || '',
      status: 'accepted'
    }
  }

  /**
   * Send a template-based email
   */
  async sendTemplate(options: SendTemplateOptions): Promise<EmailSendResult> {
    // Validate recipients
    const toRecipients = this.normalizeRecipients(options.to)
    if (toRecipients.length === 0) {
      throw new Error('At least one recipient is required')
    }

    // Build mail data
    const mailData = {
      personalizations: [
        {
          to: toRecipients,
          cc: options.cc ? this.normalizeRecipients(options.cc) : undefined,
          bcc: options.bcc ? this.normalizeRecipients(options.bcc) : undefined,
          dynamic_template_data: options.dynamicTemplateData
        }
      ],
      from: this.client.buildSender(options.from),
      reply_to: options.replyTo,
      template_id: options.templateId,
      attachments: options.attachments ? this.formatAttachments(options.attachments) : undefined,
      categories: options.categories,
      custom_args: options.customArgs,
      send_at: options.sendAt ? Math.floor(options.sendAt.getTime() / 1000) : undefined,
      mail_settings: this.client.isSandboxMode() ? { sandbox_mode: { enable: true } } : undefined
    }

    // Send via API
    const response = await this.client.request<{ messageId: string; status: string }>(
      'POST',
      '/v3/mail/send',
      mailData
    )

    if (!response.success) {
      return {
        messageId: '',
        status: 'failed',
        errors: [response.error?.message || 'Unknown error']
      }
    }

    return {
      messageId: response.data?.messageId || '',
      status: 'accepted'
    }
  }

  /**
   * Send bulk emails (up to 1000 recipients)
   */
  async sendBulk(options: SendBulkOptions): Promise<EmailSendResult> {
    // Validate personalizations
    if (!options.personalizations?.length) {
      throw new Error('At least one personalization is required')
    }

    if (options.personalizations.length > 1000) {
      throw new Error('Maximum 1000 personalizations per request')
    }

    // Build mail data
    const mailData = {
      personalizations: options.personalizations.map((p) => ({
        to: p.to,
        cc: p.cc,
        bcc: p.bcc,
        subject: p.subject,
        dynamic_template_data: p.dynamicTemplateData
      })),
      from: this.client.buildSender(options.from),
      subject: options.subject,
      template_id: options.templateId,
      content: !options.templateId ? this.buildContent(options.text, options.html) : undefined,
      categories: options.categories,
      mail_settings: this.client.isSandboxMode() ? { sandbox_mode: { enable: true } } : undefined
    }

    // Send via API
    const response = await this.client.request<{ messageId: string; status: string }>(
      'POST',
      '/v3/mail/send',
      mailData
    )

    if (!response.success) {
      return {
        messageId: '',
        status: 'failed',
        errors: [response.error?.message || 'Unknown error']
      }
    }

    return {
      messageId: response.data?.messageId || '',
      status: 'accepted'
    }
  }

  /**
   * Check if an email is suppressed (bounced, unsubscribed, etc.)
   */
  async checkSuppression(email: string): Promise<{
    suppressed: boolean
    reason?: string
  }> {
    // In production, this would check the suppression groups
    const response = await this.client.request<{ suppressed: boolean }>(
      'GET',
      `/v3/suppression/bounces/${email}`
    )

    return {
      suppressed: response.data?.suppressed || false,
      reason: response.data?.suppressed ? 'bounce' : undefined
    }
  }

  /**
   * Parse webhook events
   */
  parseWebhookEvents(body: unknown): WebhookEvent[] {
    if (!Array.isArray(body)) {
      return []
    }

    return body.map((event) => ({
      email: event.email,
      timestamp: event.timestamp,
      event: event.event as SendGridEventType,
      sg_event_id: event.sg_event_id,
      sg_message_id: event.sg_message_id,
      category: event.category,
      reason: event.reason,
      url: event.url,
      useragent: event.useragent,
      ip: event.ip
    }))
  }

  /**
   * Handle delivery events webhook
   */
  async handleDeliveryEvents(events: WebhookEvent[]): Promise<{
    processed: number
    errors: number
  }> {
    let processed = 0
    let errors = 0

    for (const event of events) {
      try {
        console.log('[SendGridSend] Event:', {
          email: event.email,
          type: event.event,
          messageId: event.sg_message_id
        })

        // In production, this would update communication records
        // via CommunicationsService.handleSendGridWebhook()

        processed++
      } catch (error) {
        console.error('[SendGridSend] Error processing event:', error)
        errors++
      }
    }

    return { processed, errors }
  }

  /**
   * Handle bounce events
   */
  async handleBounceEvent(event: WebhookEvent): Promise<void> {
    console.log('[SendGridSend] Bounce event:', {
      email: event.email,
      reason: event.reason,
      messageId: event.sg_message_id
    })

    // In production:
    // 1. Mark the contact's email as bounced
    // 2. Update communication record status
    // 3. Potentially trigger a compliance alert
  }

  /**
   * Handle unsubscribe events
   */
  async handleUnsubscribeEvent(event: WebhookEvent): Promise<void> {
    console.log('[SendGridSend] Unsubscribe event:', {
      email: event.email,
      messageId: event.sg_message_id
    })

    // In production:
    // 1. Update consent record to revoked
    // 2. Update contact preferences
    // 3. Log the unsubscribe for compliance
  }

  /**
   * Normalize recipients to standard format
   */
  private normalizeRecipients(
    recipients: string | string[] | EmailRecipient | EmailRecipient[]
  ): EmailRecipient[] {
    if (typeof recipients === 'string') {
      return [{ email: recipients }]
    }

    if (Array.isArray(recipients)) {
      return recipients.map((r) => (typeof r === 'string' ? { email: r } : r))
    }

    return [recipients]
  }

  /**
   * Build content array for SendGrid
   */
  private buildContent(text?: string, html?: string): Array<{ type: string; value: string }> {
    const content: Array<{ type: string; value: string }> = []

    if (text) {
      content.push({ type: 'text/plain', value: text })
    }

    if (html) {
      content.push({ type: 'text/html', value: html })
    }

    return content
  }

  /**
   * Format attachments for SendGrid
   */
  private formatAttachments(attachments: EmailAttachment[]): Array<{
    content: string
    filename: string
    type?: string
    disposition?: string
  }> {
    return attachments
      .filter((a) => a.content || a.url)
      .map((a) => ({
        content: a.content || '', // Base64 encoded
        filename: a.name,
        type: a.mimeType || a.type,
        disposition: 'attachment'
      }))
  }

  /**
   * Validate webhook signature (for security)
   *
   * In production, this would verify the X-Twilio-Email-Event-Webhook-Signature
   * header using SendGrid's event webhook verification.
   */
  validateWebhookSignature(
    signature: string,
    timestamp: string,
    payload: string,
    verificationKey: string
  ): boolean {
    void signature
    void timestamp
    void payload
    void verificationKey
    console.warn(
      '[SendGridSend] Webhook signature verification is not implemented in this adapter yet'
    )
    return false
  }
}

// Export factory function
export function createSendGridSend(client?: SendGridClient): SendGridSend {
  return new SendGridSend(client || new SendGridClient())
}
