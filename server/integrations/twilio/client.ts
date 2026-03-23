/**
 * Twilio Client
 *
 * Base client for Twilio API authentication and configuration.
 * Provides the foundation for SMS and Voice integrations.
 *
 * Environment variables required:
 * - TWILIO_ACCOUNT_SID: Twilio account SID
 * - TWILIO_AUTH_TOKEN: Twilio auth token
 * - TWILIO_PHONE_NUMBER: Default outbound phone number
 */

export interface TwilioConfig {
  accountSid: string
  authToken: string
  phoneNumber: string
  webhookBaseUrl?: string
}

export interface TwilioResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: number
    message: string
  }
}

/**
 * TwilioClient provides authenticated access to Twilio APIs.
 */
export class TwilioClient {
  private config: TwilioConfig
  private initialized: boolean = false

  constructor(customConfig?: Partial<TwilioConfig>) {
    this.config = {
      accountSid: customConfig?.accountSid || process.env.TWILIO_ACCOUNT_SID || '',
      authToken: customConfig?.authToken || process.env.TWILIO_AUTH_TOKEN || '',
      phoneNumber: customConfig?.phoneNumber || process.env.TWILIO_PHONE_NUMBER || '',
      webhookBaseUrl: customConfig?.webhookBaseUrl || process.env.TWILIO_WEBHOOK_BASE_URL
    }
  }

  /**
   * Initialize the Twilio client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!this.config.accountSid || !this.config.authToken) {
      console.warn('[TwilioClient] Missing credentials - Twilio delivery is disabled')
    }

    this.initialized = true
    console.log('[TwilioClient] Initialized')
  }

  /**
   * Check if client is configured with valid credentials
   */
  isConfigured(): boolean {
    return !!(this.config.accountSid && this.config.authToken && this.config.phoneNumber)
  }

  /**
   * Get the configured outbound phone number
   */
  getPhoneNumber(): string {
    return this.config.phoneNumber
  }

  /**
   * Get the webhook base URL
   */
  getWebhookBaseUrl(): string | undefined {
    return this.config.webhookBaseUrl
  }

  /**
   * Get account SID (for API calls)
   */
  getAccountSid(): string {
    return this.config.accountSid
  }

  /**
   * Get auth token (used for webhook validation).
   */
  getAuthToken(): string {
    return this.config.authToken
  }

  /**
   * Make an authenticated request to Twilio API
   */
  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    data?: Record<string, unknown>
  ): Promise<TwilioResponse<T>> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: {
          code: 401,
          message: 'Twilio client is not configured'
        }
      }
    }

    const url = new URL(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}${endpoint}`
    )

    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(
        `${this.config.accountSid}:${this.config.authToken}`
      ).toString('base64')}`
    }

    let body: string | undefined
    if (method === 'GET' && data) {
      this.appendFormData(url.searchParams, data)
    } else if (method !== 'DELETE' && data) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      const params = new URLSearchParams()
      this.appendFormData(params, data)
      body = params.toString()
    }

    const response = await fetch(url, { method, headers, body })
    const payload = await response.text()
    const parsed = payload ? this.tryParseJson(payload) : undefined

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: response.status,
          message:
            (parsed as { message?: string } | undefined)?.message ||
            payload ||
            `Twilio request failed with status ${response.status}`
        }
      }
    }

    return {
      success: true,
      data: (parsed ?? {}) as T
    }
  }

  /**
   * Validate a phone number format
   */
  validatePhoneNumber(phone: string): { valid: boolean; formatted: string } {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '')

    // Check for valid US phone number (10 or 11 digits)
    if (digits.length === 10) {
      return {
        valid: true,
        formatted: `+1${digits}`
      }
    }

    if (digits.length === 11 && digits.startsWith('1')) {
      return {
        valid: true,
        formatted: `+${digits}`
      }
    }

    // International format (assume E.164)
    if (digits.length > 10) {
      return {
        valid: true,
        formatted: `+${digits}`
      }
    }

    return {
      valid: false,
      formatted: phone
    }
  }

  /**
   * Generate webhook URLs for callbacks
   */
  generateWebhookUrls(type: 'sms' | 'voice'): {
    statusCallback?: string
    voiceUrl?: string
    fallbackUrl?: string
  } {
    const baseUrl = this.config.webhookBaseUrl
    if (!baseUrl) return {}

    if (type === 'sms') {
      return {
        statusCallback: `${baseUrl}/api/webhooks/twilio/sms/status`
      }
    }

    if (type === 'voice') {
      return {
        voiceUrl: `${baseUrl}/api/webhooks/twilio/voice/twiml`,
        statusCallback: `${baseUrl}/api/webhooks/twilio/voice/status`,
        fallbackUrl: `${baseUrl}/api/webhooks/twilio/voice/fallback`
      }
    }

    return {}
  }

  private appendFormData(params: URLSearchParams, data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) {
        continue
      }

      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item !== undefined && item !== null) {
            params.append(key, String(item))
          }
        })
        continue
      }

      params.append(key, String(value))
    }
  }

  private tryParseJson(payload: string): unknown {
    try {
      return JSON.parse(payload)
    } catch {
      return undefined
    }
  }
}

// Export singleton instance
export const twilioClient = new TwilioClient()
