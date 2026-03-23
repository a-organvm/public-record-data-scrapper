/**
 * SendGrid Client
 *
 * Base client for SendGrid API authentication and configuration.
 * Provides the foundation for email sending operations.
 *
 * Environment variables required:
 * - SENDGRID_API_KEY: SendGrid API key
 * - SENDGRID_FROM_EMAIL: Default sender email address
 * - SENDGRID_FROM_NAME: Default sender name
 */

export interface SendGridConfig {
  apiKey: string
  fromEmail: string
  fromName: string
  webhookBaseUrl?: string
  sandboxMode?: boolean
}

export interface SendGridResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: number
    message: string
    errors?: Array<{ message: string; field?: string }>
  }
}

/**
 * SendGridClient provides authenticated access to SendGrid APIs.
 */
export class SendGridClient {
  private config: SendGridConfig
  private initialized: boolean = false

  constructor(customConfig?: Partial<SendGridConfig>) {
    this.config = {
      apiKey: customConfig?.apiKey || process.env.SENDGRID_API_KEY || '',
      fromEmail:
        customConfig?.fromEmail || process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      fromName: customConfig?.fromName || process.env.SENDGRID_FROM_NAME || 'MCA Platform',
      webhookBaseUrl: customConfig?.webhookBaseUrl || process.env.SENDGRID_WEBHOOK_BASE_URL,
      sandboxMode: customConfig?.sandboxMode ?? process.env.NODE_ENV !== 'production'
    }
  }

  /**
   * Initialize the SendGrid client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!this.config.apiKey) {
      console.warn('[SendGridClient] Missing API key - email delivery is disabled')
    }

    this.initialized = true
    console.log('[SendGridClient] Initialized', {
      fromEmail: this.config.fromEmail,
      sandboxMode: this.config.sandboxMode
    })
  }

  /**
   * Check if client is configured with valid credentials
   */
  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.fromEmail)
  }

  /**
   * Get the default sender email
   */
  getFromEmail(): string {
    return this.config.fromEmail
  }

  /**
   * Get the default sender name
   */
  getFromName(): string {
    return this.config.fromName
  }

  /**
   * Check if running in sandbox mode
   */
  isSandboxMode(): boolean {
    return this.config.sandboxMode ?? false
  }

  /**
   * Get webhook base URL
   */
  getWebhookBaseUrl(): string | undefined {
    return this.config.webhookBaseUrl
  }

  /**
   * Make an authenticated request to SendGrid API
   */
  async request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    endpoint: string,
    data?: Record<string, unknown>
  ): Promise<SendGridResponse<T>> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: {
          code: 401,
          message: 'SendGrid client is not configured'
        }
      }
    }

    const url = new URL(`https://api.sendgrid.com${endpoint}`)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'application/json'
    }

    let body: string | undefined
    if (method === 'GET' && data) {
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value))
        }
      })
    } else if (method !== 'DELETE' && data) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(data)
    }

    const response = await fetch(url, { method, headers, body })
    const rawText = await response.text()
    const parsed = rawText ? this.tryParseJson(rawText) : undefined

    if (!response.ok) {
      const apiErrors = (parsed as { errors?: Array<{ message?: string }> } | undefined)?.errors
      return {
        success: false,
        error: {
          code: response.status,
          message:
            apiErrors
              ?.map((entry) => entry.message)
              .filter(Boolean)
              .join('; ') ||
            rawText ||
            `SendGrid request failed with status ${response.status}`,
          errors: apiErrors
        }
      }
    }

    if (endpoint === '/v3/mail/send') {
      return {
        success: true,
        data: {
          messageId: response.headers.get('x-message-id') || '',
          status: 'accepted'
        } as T
      }
    }

    return {
      success: true,
      data: (parsed ?? {}) as T
    }
  }

  /**
   * Validate an email address format
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  /**
   * Build sender information
   */
  buildSender(from?: { email?: string; name?: string }): { email: string; name: string } {
    return {
      email: from?.email || this.config.fromEmail,
      name: from?.name || this.config.fromName
    }
  }

  /**
   * Generate webhook event URLs
   */
  generateWebhookUrls(): {
    eventWebhook?: string
    bounceWebhook?: string
    unsubscribeWebhook?: string
  } {
    const baseUrl = this.config.webhookBaseUrl
    if (!baseUrl) return {}

    return {
      eventWebhook: `${baseUrl}/api/webhooks/sendgrid/events`,
      bounceWebhook: `${baseUrl}/api/webhooks/sendgrid/bounce`,
      unsubscribeWebhook: `${baseUrl}/api/webhooks/sendgrid/unsubscribe`
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
export const sendgridClient = new SendGridClient()
