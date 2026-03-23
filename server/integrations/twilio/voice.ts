/**
 * Twilio Voice Integration
 *
 * Provides voice call capabilities:
 * - Initiate outbound calls
 * - Generate TwiML for call flow
 * - Handle call status webhooks
 * - Call recording management
 *
 * Webhook endpoints to implement:
 * - POST /api/webhooks/twilio/voice/twiml - TwiML instructions for calls
 * - POST /api/webhooks/twilio/voice/status - Call status updates
 * - POST /api/webhooks/twilio/voice/recording - Recording completed
 * - POST /api/webhooks/twilio/voice/fallback - Error fallback
 */

import { TwilioClient } from './client'
import { createHmac, timingSafeEqual } from 'crypto'

export interface InitiateCallOptions {
  to: string
  from?: string
  callScript?: string
  twimlUrl?: string
  record?: boolean
  recordingStatusCallback?: string
  statusCallback?: string
  timeout?: number
  machineDetection?: 'Enable' | 'DetectMessageEnd'
}

export interface CallRecord {
  callSid: string
  accountSid: string
  to: string
  from: string
  status: CallStatus
  direction: 'inbound' | 'outbound-api' | 'outbound-dial'
  dateCreated: string
  dateUpdated: string
  startTime?: string
  endTime?: string
  duration?: number
  answeredBy?: 'human' | 'machine' | 'unknown'
  forwardedFrom?: string
  callerName?: string
}

export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'canceled'
  | 'failed'

export interface CallWebhookPayload {
  CallSid: string
  AccountSid: string
  From: string
  To: string
  CallStatus: CallStatus
  Direction: string
  ForwardedFrom?: string
  CallerName?: string
  Duration?: string
  RecordingUrl?: string
  RecordingSid?: string
  RecordingDuration?: string
  Digits?: string
  SpeechResult?: string
  Confidence?: string
  AnsweredBy?: string
  MachineDetectionDuration?: string
}

export interface TwiMLOptions {
  say?: {
    text: string
    voice?: string
    language?: string
  }
  play?: {
    url: string
    loop?: number
  }
  gather?: {
    input?: 'dtmf' | 'speech' | 'dtmf speech'
    action?: string
    method?: 'GET' | 'POST'
    timeout?: number
    numDigits?: number
    finishOnKey?: string
    speechTimeout?: number
    hints?: string
  }
  dial?: {
    number: string
    callerId?: string
    timeout?: number
    action?: string
    record?: 'do-not-record' | 'record-from-answer' | 'record-from-ringing'
  }
  record?: {
    action?: string
    method?: 'GET' | 'POST'
    timeout?: number
    maxLength?: number
    transcribe?: boolean
    transcribeCallback?: string
    playBeep?: boolean
  }
  pause?: {
    length?: number
  }
  redirect?: {
    url: string
    method?: 'GET' | 'POST'
  }
  hangup?: boolean
}

/**
 * TwilioVoice provides voice calling capabilities.
 */
export class TwilioVoice {
  private client: TwilioClient

  constructor(client: TwilioClient) {
    this.client = client
  }

  /**
   * Initiate an outbound call
   */
  async initiateCall(options: InitiateCallOptions): Promise<{
    callSid: string
    status: CallStatus
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
      From: options.from || this.client.getPhoneNumber()
    }

    // Set TwiML URL or generate inline TwiML
    const webhookUrls = this.client.generateWebhookUrls('voice')
    if (options.twimlUrl) {
      requestData.Url = options.twimlUrl
    } else if (webhookUrls.voiceUrl) {
      requestData.Url = webhookUrls.voiceUrl
    } else {
      // Generate simple TwiML for the call
      requestData.Twiml = this.generateTwiML([
        {
          say: {
            text: options.callScript || 'Hello, this is an automated call. Goodbye.',
            voice: 'Polly.Matthew'
          }
        }
      ])
    }

    // Add status callback
    if (options.statusCallback || webhookUrls.statusCallback) {
      requestData.StatusCallback = options.statusCallback || webhookUrls.statusCallback
      requestData.StatusCallbackEvent = ['initiated', 'ringing', 'answered', 'completed']
    }

    // Add fallback URL
    if (webhookUrls.fallbackUrl) {
      requestData.FallbackUrl = webhookUrls.fallbackUrl
    }

    // Recording options
    if (options.record) {
      requestData.Record = true
      if (options.recordingStatusCallback) {
        requestData.RecordingStatusCallback = options.recordingStatusCallback
      }
    }

    // Timeout (default 30 seconds)
    requestData.Timeout = options.timeout || 30

    // Machine detection
    if (options.machineDetection) {
      requestData.MachineDetection = options.machineDetection
    }

    // Make API request
    const response = await this.client.request<{
      sid: string
      status: CallStatus
      dateCreated: string
    }>('POST', '/Calls.json', requestData)

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Failed to initiate call')
    }

    return {
      callSid: response.data.sid,
      status: response.data.status,
      dateCreated: response.data.dateCreated
    }
  }

  /**
   * Get call details by SID
   */
  async getCall(callSid: string): Promise<CallRecord | null> {
    const response = await this.client.request<CallRecord>('GET', `/Calls/${callSid}.json`)

    if (!response.success) {
      return null
    }

    return response.data || null
  }

  /**
   * Update an in-progress call
   */
  async updateCall(
    callSid: string,
    updates: {
      twiml?: string
      url?: string
      status?: 'completed' | 'canceled'
    }
  ): Promise<boolean> {
    const requestData: Record<string, unknown> = {}

    if (updates.twiml) {
      requestData.Twiml = updates.twiml
    }
    if (updates.url) {
      requestData.Url = updates.url
    }
    if (updates.status) {
      requestData.Status = updates.status
    }

    const response = await this.client.request('POST', `/Calls/${callSid}.json`, requestData)

    return response.success
  }

  /**
   * End a call
   */
  async endCall(callSid: string): Promise<boolean> {
    return this.updateCall(callSid, { status: 'completed' })
  }

  /**
   * Generate TwiML XML from options
   */
  generateTwiML(instructions: TwiMLOptions[]): string {
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>'

    for (const instruction of instructions) {
      if (instruction.say) {
        const voice = instruction.say.voice || 'Polly.Matthew'
        const lang = instruction.say.language || 'en-US'
        const escapedText = this.escapeXML(instruction.say.text)
        twiml += `<Say voice="${voice}" language="${lang}">${escapedText}</Say>`
      }

      if (instruction.play) {
        const loop = instruction.play.loop || 1
        twiml += `<Play loop="${loop}">${instruction.play.url}</Play>`
      }

      if (instruction.gather) {
        const g = instruction.gather
        let gatherAttrs = ''
        if (g.input) gatherAttrs += ` input="${g.input}"`
        if (g.action) gatherAttrs += ` action="${g.action}"`
        if (g.method) gatherAttrs += ` method="${g.method}"`
        if (g.timeout) gatherAttrs += ` timeout="${g.timeout}"`
        if (g.numDigits) gatherAttrs += ` numDigits="${g.numDigits}"`
        if (g.finishOnKey) gatherAttrs += ` finishOnKey="${g.finishOnKey}"`
        if (g.speechTimeout) gatherAttrs += ` speechTimeout="${g.speechTimeout}"`
        if (g.hints) gatherAttrs += ` hints="${g.hints}"`
        twiml += `<Gather${gatherAttrs}></Gather>`
      }

      if (instruction.dial) {
        const d = instruction.dial
        let dialAttrs = ''
        if (d.callerId) dialAttrs += ` callerId="${d.callerId}"`
        if (d.timeout) dialAttrs += ` timeout="${d.timeout}"`
        if (d.action) dialAttrs += ` action="${d.action}"`
        if (d.record) dialAttrs += ` record="${d.record}"`
        twiml += `<Dial${dialAttrs}>${d.number}</Dial>`
      }

      if (instruction.record) {
        const r = instruction.record
        let recordAttrs = ''
        if (r.action) recordAttrs += ` action="${r.action}"`
        if (r.method) recordAttrs += ` method="${r.method}"`
        if (r.timeout) recordAttrs += ` timeout="${r.timeout}"`
        if (r.maxLength) recordAttrs += ` maxLength="${r.maxLength}"`
        if (r.transcribe !== undefined) recordAttrs += ` transcribe="${r.transcribe}"`
        if (r.transcribeCallback) recordAttrs += ` transcribeCallback="${r.transcribeCallback}"`
        if (r.playBeep !== undefined) recordAttrs += ` playBeep="${r.playBeep}"`
        twiml += `<Record${recordAttrs}/>`
      }

      if (instruction.pause) {
        const length = instruction.pause.length || 1
        twiml += `<Pause length="${length}"/>`
      }

      if (instruction.redirect) {
        const method = instruction.redirect.method || 'POST'
        twiml += `<Redirect method="${method}">${instruction.redirect.url}</Redirect>`
      }

      if (instruction.hangup) {
        twiml += '<Hangup/>'
      }
    }

    twiml += '</Response>'
    return twiml
  }

  /**
   * Generate TwiML for a broker call script
   */
  generateBrokerCallScript(options: {
    greeting: string
    companyName: string
    brokerName: string
    callbackNumber: string
  }): string {
    const script = `
      Hello, this is ${options.brokerName} calling from ${options.companyName}.
      I'm reaching out regarding a business financing opportunity.
      If you're interested in learning more, please call us back at ${options.callbackNumber}.
      Thank you and have a great day.
    `
      .trim()
      .replace(/\s+/g, ' ')

    return this.generateTwiML([
      { say: { text: script, voice: 'Polly.Matthew' } },
      { pause: { length: 1 } },
      { hangup: true }
    ])
  }

  /**
   * Parse and validate call webhook payload
   */
  parseWebhookPayload(body: Record<string, string>): CallWebhookPayload {
    return {
      CallSid: body.CallSid,
      AccountSid: body.AccountSid,
      From: body.From,
      To: body.To,
      CallStatus: body.CallStatus as CallStatus,
      Direction: body.Direction,
      ForwardedFrom: body.ForwardedFrom,
      CallerName: body.CallerName,
      Duration: body.Duration,
      RecordingUrl: body.RecordingUrl,
      RecordingSid: body.RecordingSid,
      RecordingDuration: body.RecordingDuration,
      Digits: body.Digits,
      SpeechResult: body.SpeechResult,
      Confidence: body.Confidence,
      AnsweredBy: body.AnsweredBy,
      MachineDetectionDuration: body.MachineDetectionDuration
    }
  }

  /**
   * Handle call status webhook
   */
  async handleStatusUpdate(payload: CallWebhookPayload): Promise<{
    processed: boolean
    status: CallStatus
    duration?: number
  }> {
    console.log('[TwilioVoice] Status update:', {
      callSid: payload.CallSid,
      status: payload.CallStatus,
      duration: payload.Duration,
      answeredBy: payload.AnsweredBy
    })

    // In production, this would update the communication record
    // via CommunicationsService.handleTwilioCallWebhook()

    return {
      processed: true,
      status: payload.CallStatus,
      duration: payload.Duration ? parseInt(payload.Duration) : undefined
    }
  }

  /**
   * Handle recording completed webhook
   */
  async handleRecordingComplete(payload: CallWebhookPayload): Promise<{
    processed: boolean
    recordingUrl?: string
    duration?: number
  }> {
    console.log('[TwilioVoice] Recording complete:', {
      callSid: payload.CallSid,
      recordingSid: payload.RecordingSid,
      recordingUrl: payload.RecordingUrl,
      duration: payload.RecordingDuration
    })

    return {
      processed: true,
      recordingUrl: payload.RecordingUrl,
      duration: payload.RecordingDuration ? parseInt(payload.RecordingDuration) : undefined
    }
  }

  /**
   * Validate webhook signature
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

  /**
   * Escape XML special characters
   */
  private escapeXML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}

// Export factory function
export function createTwilioVoice(client?: TwilioClient): TwilioVoice {
  return new TwilioVoice(client || new TwilioClient())
}
