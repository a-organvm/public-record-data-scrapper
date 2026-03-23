/**
 * Twilio SMS Integration
 *
 * Provides SMS messaging capabilities:
 * - Send SMS messages
 * - Handle delivery status webhooks
 * - Message scheduling (via Twilio's native scheduling)
 *
 * Webhook endpoints to implement:
 * - POST /api/webhooks/twilio/sms/status - Delivery status updates
 * - POST /api/webhooks/twilio/sms/inbound - Inbound message handling
 */

import { TwilioClient } from './client'
import { createHmac, timingSafeEqual } from 'crypto'

export interface SendSMSOptions {
  to: string
  body: string
  from?: string
  mediaUrls?: string[]
  statusCallback?: string
  scheduleSendTime?: Date
}

export interface SMSMessage {
  messageSid: string
  accountSid: string
  to: string
  from: string
  body: string
  status: SMSStatus
  dateCreated: string
  dateUpdated: string
  direction: 'inbound' | 'outbound-api' | 'outbound-call' | 'outbound-reply'
  errorCode?: number
  errorMessage?: string
  numSegments: number
  price?: string
  priceUnit: string
  mediaUrls?: string[]
}

export type SMSStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'receiving'
  | 'received'
  | 'accepted'
  | 'scheduled'
  | 'read'
  | 'partially_delivered'
  | 'canceled'

export interface SMSWebhookPayload {
  MessageSid: string
  AccountSid: string
  From: string
  To: string
  Body: string
  MessageStatus: SMSStatus
  ErrorCode?: string
  ErrorMessage?: string
  NumMedia?: string
  MediaUrl0?: string
  MediaContentType0?: string
}

/**
 * TwilioSMS provides SMS messaging capabilities.
 */
export class TwilioSMS {
  private client: TwilioClient

  constructor(client: TwilioClient) {
    this.client = client
  }

  /**
   * Send an SMS message
   */
  async send(options: SendSMSOptions): Promise<{
    messageSid: string
    status: SMSStatus
    dateCreated: string
  }> {
    // Validate and format phone number
    const phoneValidation = this.client.validatePhoneNumber(options.to)
    if (!phoneValidation.valid) {
      throw new Error(`Invalid phone number: ${options.to}`)
    }

    // Build request data
    const requestData: Record<string, unknown> = {
      To: phoneValidation.formatted,
      From: options.from || this.client.getPhoneNumber(),
      Body: options.body
    }

    // Add media URLs if provided (for MMS)
    if (options.mediaUrls?.length) {
      requestData.MediaUrl = options.mediaUrls
    }

    // Add status callback
    const webhookUrls = this.client.generateWebhookUrls('sms')
    if (options.statusCallback || webhookUrls.statusCallback) {
      requestData.StatusCallback = options.statusCallback || webhookUrls.statusCallback
    }

    // Add scheduling if provided
    if (options.scheduleSendTime) {
      requestData.SendAt = options.scheduleSendTime.toISOString()
      requestData.ScheduleType = 'fixed'
    }

    // Make API request
    const response = await this.client.request<{
      sid: string
      status: SMSStatus
      dateCreated: string
    }>('POST', '/Messages.json', requestData)

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to send SMS')
    }

    return {
      messageSid: response.data.sid,
      status: response.data.status,
      dateCreated: response.data.dateCreated
    }
  }

  /**
   * Get message details by SID
   */
  async getMessage(messageSid: string): Promise<SMSMessage | null> {
    const response = await this.client.request<SMSMessage>('GET', `/Messages/${messageSid}.json`)

    if (!response.success) {
      return null
    }

    return response.data || null
  }

  /**
   * Cancel a scheduled message
   */
  async cancelScheduledMessage(messageSid: string): Promise<boolean> {
    const response = await this.client.request('POST', `/Messages/${messageSid}.json`, {
      Status: 'canceled'
    })

    return response.success
  }

  /**
   * Parse and validate webhook payload
   */
  parseWebhookPayload(body: Record<string, string>): SMSWebhookPayload {
    return {
      MessageSid: body.MessageSid,
      AccountSid: body.AccountSid,
      From: body.From,
      To: body.To,
      Body: body.Body || '',
      MessageStatus: body.MessageStatus as SMSStatus,
      ErrorCode: body.ErrorCode,
      ErrorMessage: body.ErrorMessage,
      NumMedia: body.NumMedia,
      MediaUrl0: body.MediaUrl0,
      MediaContentType0: body.MediaContentType0
    }
  }

  /**
   * Handle inbound SMS webhook
   *
   * This method processes incoming SMS messages and can trigger
   * automated responses or notifications.
   */
  async handleInboundMessage(payload: SMSWebhookPayload): Promise<{
    processed: boolean
    responseMessage?: string
  }> {
    console.log('[TwilioSMS] Inbound message:', {
      from: payload.From,
      to: payload.To,
      body: payload.Body?.substring(0, 50)
    })

    // Check for opt-out keywords
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']
    const messageUpper = payload.Body.toUpperCase().trim()

    if (optOutKeywords.includes(messageUpper)) {
      // Handle opt-out - in production, this would update consent records
      console.log('[TwilioSMS] Opt-out received from:', payload.From)
      return {
        processed: true,
        responseMessage: 'You have been unsubscribed. Reply START to resubscribe.'
      }
    }

    // Check for opt-in keywords
    if (messageUpper === 'START' || messageUpper === 'SUBSCRIBE') {
      console.log('[TwilioSMS] Opt-in received from:', payload.From)
      return {
        processed: true,
        responseMessage: 'You have been subscribed. Reply STOP to unsubscribe.'
      }
    }

    // Default: message received but no automated response
    return {
      processed: true
    }
  }

  /**
   * Handle delivery status webhook
   */
  async handleStatusUpdate(payload: SMSWebhookPayload): Promise<{
    processed: boolean
    status: SMSStatus
  }> {
    console.log('[TwilioSMS] Status update:', {
      messageSid: payload.MessageSid,
      status: payload.MessageStatus,
      errorCode: payload.ErrorCode
    })

    // In production, this would update the communication record
    // via CommunicationsService.handleTwilioSMSWebhook()

    return {
      processed: true,
      status: payload.MessageStatus
    }
  }

  /**
   * Generate TwiML response for inbound SMS
   */
  generateTwiMLResponse(message?: string): string {
    if (!message) {
      return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    }

    // Escape XML special characters
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapedMessage}</Message></Response>`
  }

  /**
   * Validate webhook signature (for security)
   *
   * In production, this would verify the X-Twilio-Signature header
   * using the Twilio SDK's validateRequest function.
   */
  validateWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): boolean {
    const authToken = this.client.getAuthToken()
    if (!authToken || !signature) {
      return false
    }

    const data =
      url +
      Object.keys(params)
        .sort()
        .map((key) => `${key}${params[key]}`)
        .join('')

    const expectedSignature = createHmac('sha1', authToken).update(data).digest('base64')

    const expectedBuffer = Buffer.from(expectedSignature)
    const receivedBuffer = Buffer.from(signature)

    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    )
  }
}

// Export factory function
export function createTwilioSMS(client?: TwilioClient): TwilioSMS {
  return new TwilioSMS(client || new TwilioClient())
}
