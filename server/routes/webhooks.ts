/**
 * Webhook Routes
 *
 * Handles incoming webhooks from external services:
 * - Twilio: SMS delivery status, inbound SMS, voice call status
 * - SendGrid: Email events (delivered, opened, clicked, bounced)
 * - Plaid: Transaction updates, item status changes
 *
 * All webhook endpoints verify signatures before processing.
 */

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/errorHandler'
import { validateRequest } from '../middleware/validateRequest'
import {
  verifyTwilioSignature,
  verifySendGridSignature,
  verifyPlaidSignature
} from '../middleware/webhookAuth'
import { CommunicationsService } from '../services/CommunicationsService'
import { database } from '../database/connection'

const router = Router()

// ============================================
// Twilio SMS Webhooks
// ============================================

/**
 * SMS delivery status webhook schema
 *
 * Twilio sends status updates as the message progresses through delivery.
 */
const twilioSmsStatusSchema = z.object({
  MessageSid: z.string().min(1),
  MessageStatus: z.enum([
    'queued',
    'failed',
    'sent',
    'delivered',
    'undelivered',
    'receiving',
    'received',
    'accepted'
  ]),
  To: z.string().optional(),
  From: z.string().optional(),
  ErrorCode: z.string().optional(),
  ErrorMessage: z.string().optional()
})

/**
 * POST /api/webhooks/twilio/sms/status
 *
 * Receives SMS delivery status updates from Twilio.
 * Updates the communication record with the new status.
 */
router.post(
  '/twilio/sms/status',
  verifyTwilioSignature,
  validateRequest({ body: twilioSmsStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof twilioSmsStatusSchema>

    console.log('[webhooks] Twilio SMS status received:', {
      messageSid: body.MessageSid,
      status: body.MessageStatus,
      errorCode: body.ErrorCode
    })

    const communicationsService = new CommunicationsService()

    await communicationsService.handleTwilioSMSWebhook({
      MessageSid: body.MessageSid,
      MessageStatus: body.MessageStatus,
      ErrorCode: body.ErrorCode,
      ErrorMessage: body.ErrorMessage
    })

    // Twilio expects empty 200 response
    res.status(200).send()
  })
)

/**
 * Inbound SMS webhook schema
 *
 * Twilio sends inbound messages with full message details.
 */
const twilioSmsInboundSchema = z.object({
  MessageSid: z.string().min(1),
  AccountSid: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
  Body: z.string(),
  NumMedia: z.coerce.number().default(0),
  // Media URLs if present (up to 10)
  MediaUrl0: z.string().url().optional(),
  MediaUrl1: z.string().url().optional(),
  MediaUrl2: z.string().url().optional(),
  MediaContentType0: z.string().optional(),
  MediaContentType1: z.string().optional(),
  MediaContentType2: z.string().optional()
})

/**
 * POST /api/webhooks/twilio/sms/inbound
 *
 * Receives inbound SMS messages from Twilio.
 * Creates a communication record for the incoming message.
 */
router.post(
  '/twilio/sms/inbound',
  verifyTwilioSignature,
  validateRequest({ body: twilioSmsInboundSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof twilioSmsInboundSchema>

    console.log('[webhooks] Twilio inbound SMS received:', {
      messageSid: body.MessageSid,
      from: body.From,
      to: body.To
    })

    // Extract media attachments if present. Twilio sends at most 10 media
    // parts; the schema only models the first 3. Bound the loop to the smaller
    // of the reported count and the supported field count to avoid an
    // unbounded loop driven by an attacker-controlled NumMedia value.
    const MAX_SUPPORTED_MEDIA = 3
    const mediaCount = Math.max(0, Math.min(body.NumMedia, MAX_SUPPORTED_MEDIA))
    const attachments: Array<{ url: string; contentType: string }> = []
    for (let i = 0; i < mediaCount; i++) {
      const urlKey = `MediaUrl${i}` as keyof typeof body
      const typeKey = `MediaContentType${i}` as keyof typeof body
      if (body[urlKey]) {
        attachments.push({
          url: body[urlKey] as string,
          contentType: (body[typeKey] as string) || 'application/octet-stream'
        })
      }
    }

    try {
      // Resolve the contact for this inbound message. The previous lookup used
      // a `LIKE '%<last10>'` match with no tenant scoping and `LIMIT 1`, which
      // could attach the message to an ARBITRARY tenant's contact and stamp
      // that tenant's org_id onto the record (cross-tenant data leakage).
      //
      // Without an org↔Twilio-number mapping we cannot derive the receiving
      // org from `To`, so we fail closed: only associate a contact (and its
      // org) when the sender's full normalized phone matches EXACTLY ONE
      // contact. If the match is ambiguous (multiple tenants share the number)
      // we leave contact_id/org_id NULL rather than guess.
      //
      // TODO(security): introduce an organization↔Twilio-number mapping so the
      // receiving org can be derived from `To`, then scope the contact lookup
      // to that org.
      const normalizedPhone = body.From.replace(/\D/g, '')
      const last10 = normalizedPhone.slice(-10)
      const contactResults = await database.query<{ id: string; org_id: string }>(
        `SELECT c.id, c.org_id FROM contacts c
         WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g'), 10) = $1
            OR RIGHT(REGEXP_REPLACE(COALESCE(c.mobile, ''), '\\D', '', 'g'), 10) = $1
         LIMIT 2`,
        [last10]
      )

      // Only trust the association when it is unambiguous (single match).
      const contact = contactResults.length === 1 ? contactResults[0] : undefined
      if (contactResults.length > 1) {
        console.warn(
          '[webhooks] Inbound SMS phone matched multiple tenants; leaving contact/org unset',
          { messageSid: body.MessageSid, last10 }
        )
      }

      // Create inbound communication record
      await database.query(
        `INSERT INTO communications (
          org_id, contact_id, channel, direction, from_phone, to_phone,
          body, external_id, status, metadata, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          contact?.org_id || null,
          contact?.id || null,
          'sms',
          'inbound',
          body.From,
          body.To,
          body.Body,
          body.MessageSid,
          'received',
          JSON.stringify({ attachments, accountSid: body.AccountSid })
        ]
      )

      console.log('[webhooks] Inbound SMS recorded successfully')
    } catch (error) {
      // Log with context for observability; do NOT swallow silently. We still
      // return 200 below so Twilio does not retry a request that will keep
      // failing (e.g. a persistent DB error), but the failure is recorded.
      console.error('[webhooks] Failed to record inbound SMS', {
        messageSid: body.MessageSid,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Return TwiML response (empty response for no auto-reply)
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  })
)

// ============================================
// Twilio Voice Webhooks
// ============================================

/**
 * Voice call status webhook schema
 */
const twilioVoiceStatusSchema = z.object({
  CallSid: z.string().min(1),
  AccountSid: z.string().min(1),
  From: z.string().optional(),
  To: z.string().optional(),
  CallStatus: z.enum([
    'queued',
    'ringing',
    'in-progress',
    'completed',
    'busy',
    'no-answer',
    'canceled',
    'failed'
  ]),
  CallDuration: z.coerce.number().optional(),
  Duration: z.coerce.number().optional(),
  RecordingUrl: z.string().url().optional(),
  RecordingSid: z.string().optional(),
  Direction: z.enum(['inbound', 'outbound-api', 'outbound-dial']).optional(),
  AnsweredBy: z.enum(['human', 'machine', 'fax', 'unknown']).optional()
})

/**
 * POST /api/webhooks/twilio/voice/status
 *
 * Receives voice call status updates from Twilio.
 * Updates the communication record with call details.
 */
router.post(
  '/twilio/voice/status',
  verifyTwilioSignature,
  validateRequest({ body: twilioVoiceStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof twilioVoiceStatusSchema>

    console.log('[webhooks] Twilio voice status received:', {
      callSid: body.CallSid,
      status: body.CallStatus,
      duration: body.CallDuration || body.Duration
    })

    const communicationsService = new CommunicationsService()

    await communicationsService.handleTwilioCallWebhook({
      CallSid: body.CallSid,
      CallStatus: body.CallStatus,
      Duration: String(body.CallDuration || body.Duration || 0),
      RecordingUrl: body.RecordingUrl
    })

    // Twilio expects empty 200 response
    res.status(200).send()
  })
)

// ============================================
// SendGrid Webhooks
// ============================================

/**
 * SendGrid event webhook schema
 *
 * SendGrid batches events and sends them as an array.
 */
const sendgridEventSchema = z.object({
  email: z.string().email().optional(),
  timestamp: z.number().optional(),
  event: z.enum([
    'processed',
    'dropped',
    'delivered',
    'deferred',
    'bounce',
    'open',
    'click',
    'spam_report',
    'unsubscribe',
    'group_unsubscribe',
    'group_resubscribe'
  ]),
  sg_event_id: z.string().optional(),
  sg_message_id: z.string().optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  url: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
  response: z.string().optional(),
  attempt: z.string().optional(),
  useragent: z.string().optional(),
  ip: z.string().optional()
})

const sendgridEventsSchema = z.array(sendgridEventSchema)

/**
 * POST /api/webhooks/sendgrid/events
 *
 * Receives email event notifications from SendGrid.
 * Processes events like delivered, opened, clicked, bounced.
 */
router.post(
  '/sendgrid/events',
  verifySendGridSignature,
  asyncHandler(async (req: Request, res: Response) => {
    // SendGrid sends events as an array
    const parseResult = sendgridEventsSchema.safeParse(req.body)

    if (!parseResult.success) {
      console.error('[webhooks] Invalid SendGrid event format:', parseResult.error)
      // Still return 200 to prevent retries for malformed events
      return res.status(200).send()
    }

    const events = parseResult.data

    console.log('[webhooks] SendGrid events received:', {
      count: events.length,
      types: [...new Set(events.map((e) => e.event))]
    })

    const communicationsService = new CommunicationsService()

    // Process each event
    for (const event of events) {
      try {
        // Extract message ID from sg_message_id (format: "message_id.filter_id")
        const messageId = event.sg_message_id?.split('.')[0]

        if (messageId) {
          await communicationsService.handleSendGridWebhook({
            event: event.event,
            messageId,
            timestamp: event.timestamp
              ? new Date(event.timestamp * 1000).toISOString()
              : new Date().toISOString(),
            reason: event.reason
          })
        }
      } catch (error) {
        console.error('[webhooks] Failed to process SendGrid event:', error, event)
        // Continue processing other events
      }
    }

    // SendGrid expects 200 response
    res.status(200).send()
  })
)

// ============================================
// Plaid Webhooks
// ============================================

/**
 * Plaid transaction webhook schema
 */
const plaidTransactionSchema = z.object({
  webhook_type: z.literal('TRANSACTIONS'),
  webhook_code: z.enum([
    'INITIAL_UPDATE',
    'HISTORICAL_UPDATE',
    'DEFAULT_UPDATE',
    'TRANSACTIONS_REMOVED',
    'SYNC_UPDATES_AVAILABLE'
  ]),
  item_id: z.string().min(1),
  new_transactions: z.number().optional(),
  removed_transactions: z.array(z.string()).optional(),
  error: z
    .object({
      error_type: z.string(),
      error_code: z.string(),
      error_message: z.string()
    })
    .optional()
})

/**
 * POST /api/webhooks/plaid/transactions
 *
 * Receives transaction update notifications from Plaid.
 * Triggers sync for new or updated transactions.
 */
router.post(
  '/plaid/transactions',
  verifyPlaidSignature,
  validateRequest({ body: plaidTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof plaidTransactionSchema>

    console.log('[webhooks] Plaid transaction webhook received:', {
      itemId: body.item_id,
      code: body.webhook_code,
      newTransactions: body.new_transactions
    })

    if (body.error) {
      console.error('[webhooks] Plaid transaction error:', body.error)
    }

    try {
      // Record the webhook event
      await database.query(
        `INSERT INTO plaid_webhook_events (
          item_id, webhook_type, webhook_code, new_transactions,
          removed_transactions, error, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [
          body.item_id,
          body.webhook_type,
          body.webhook_code,
          body.new_transactions || 0,
          body.removed_transactions || [],
          body.error ? JSON.stringify(body.error) : null
        ]
      )

      // For DEFAULT_UPDATE or SYNC_UPDATES_AVAILABLE, trigger a transaction sync
      if (
        body.webhook_code === 'DEFAULT_UPDATE' ||
        body.webhook_code === 'SYNC_UPDATES_AVAILABLE'
      ) {
        // Find the deal/prospect associated with this Plaid item
        const itemResults = await database.query<{ deal_id: string; prospect_id: string }>(
          'SELECT deal_id, prospect_id FROM plaid_items WHERE item_id = $1',
          [body.item_id]
        )

        if (itemResults[0]) {
          // TODO: Queue a job to sync transactions for this item
          console.log('[webhooks] Would queue transaction sync for:', {
            itemId: body.item_id,
            dealId: itemResults[0].deal_id,
            prospectId: itemResults[0].prospect_id
          })
        }
      }
    } catch (error) {
      console.error('[webhooks] Failed to process Plaid transaction webhook:', error)
    }

    // Plaid expects 200 response
    res.status(200).send()
  })
)

/**
 * Plaid item webhook schema
 */
const plaidItemSchema = z.object({
  webhook_type: z.literal('ITEM'),
  webhook_code: z.enum([
    'ERROR',
    'PENDING_EXPIRATION',
    'USER_PERMISSION_REVOKED',
    'WEBHOOK_UPDATE_ACKNOWLEDGED',
    'NEW_ACCOUNTS_AVAILABLE'
  ]),
  item_id: z.string().min(1),
  error: z
    .object({
      error_type: z.string(),
      error_code: z.string(),
      error_message: z.string(),
      display_message: z.string().optional()
    })
    .optional(),
  consent_expiration_time: z.string().optional()
})

/**
 * POST /api/webhooks/plaid/item
 *
 * Receives item status change notifications from Plaid.
 * Handles errors, expiration, and permission changes.
 */
router.post(
  '/plaid/item',
  verifyPlaidSignature,
  validateRequest({ body: plaidItemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof plaidItemSchema>

    console.log('[webhooks] Plaid item webhook received:', {
      itemId: body.item_id,
      code: body.webhook_code,
      hasError: !!body.error
    })

    try {
      // Record the webhook event
      await database.query(
        `INSERT INTO plaid_webhook_events (
          item_id, webhook_type, webhook_code, error, received_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [
          body.item_id,
          body.webhook_type,
          body.webhook_code,
          body.error ? JSON.stringify(body.error) : null
        ]
      )

      // Update item status based on webhook code
      let status = 'active'
      let errorMessage: string | null = null

      switch (body.webhook_code) {
        case 'ERROR':
          status = 'error'
          errorMessage = body.error?.error_message || 'Unknown error'
          break
        case 'PENDING_EXPIRATION':
          status = 'pending_expiration'
          break
        case 'USER_PERMISSION_REVOKED':
          status = 'revoked'
          break
        case 'NEW_ACCOUNTS_AVAILABLE':
          // User has added new accounts, may need to re-link
          console.log('[webhooks] New accounts available for item:', body.item_id)
          break
      }

      // Update the item record
      await database.query(
        `UPDATE plaid_items SET
          status = $2,
          error_message = $3,
          consent_expiration_time = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE item_id = $1`,
        [body.item_id, status, errorMessage, body.consent_expiration_time]
      )

      // If there's an error, notify the user/broker
      if (body.webhook_code === 'ERROR' || body.webhook_code === 'USER_PERMISSION_REVOKED') {
        // Find the associated deal/contact
        const itemResults = await database.query<{
          deal_id: string
          prospect_id: string
          contact_id: string
        }>('SELECT deal_id, prospect_id, contact_id FROM plaid_items WHERE item_id = $1', [
          body.item_id
        ])

        if (itemResults[0]) {
          // TODO: Send notification to broker about the issue
          console.log('[webhooks] Plaid item requires attention:', {
            itemId: body.item_id,
            status,
            dealId: itemResults[0].deal_id,
            error: body.error
          })
        }
      }
    } catch (error) {
      console.error('[webhooks] Failed to process Plaid item webhook:', error)
    }

    // Plaid expects 200 response
    res.status(200).send()
  })
)

export default router
