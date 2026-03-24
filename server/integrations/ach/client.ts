/**
 * ACH Client
 *
 * Adapter shell for Actum/ACH Works-style ACH payment processing.
 * Supports debit/credit transactions, status checking, and account validation.
 *
 * Environment variables required:
 * - ACH_API_KEY: API key for ACH provider
 * - ACH_MERCHANT_ID: Merchant identifier
 * - ACH_ENVIRONMENT: 'sandbox' or 'production'
 */

export interface ACHConfig {
  apiKey: string
  merchantId: string
  environment: 'sandbox' | 'production'
  webhookBaseUrl?: string
}

export type ACHStatus = 'pending' | 'processing' | 'completed' | 'returned' | 'failed'

export interface ACHResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface ACHTransaction {
  transactionId: string
  type: 'debit' | 'credit'
  amount: number
  accountId: string
  status: ACHStatus
  createdAt: string
  updatedAt: string
}

/**
 * ACHClient provides access to ACH payment processing APIs.
 */
export class ACHClient {
  private config: ACHConfig
  private initialized: boolean = false

  constructor(customConfig?: Partial<ACHConfig>) {
    this.config = {
      apiKey: customConfig?.apiKey || process.env.ACH_API_KEY || '',
      merchantId: customConfig?.merchantId || process.env.ACH_MERCHANT_ID || '',
      environment: (customConfig?.environment || process.env.ACH_ENVIRONMENT || 'sandbox') as
        | 'sandbox'
        | 'production',
      webhookBaseUrl: customConfig?.webhookBaseUrl || process.env.ACH_WEBHOOK_BASE_URL
    }
  }

  /**
   * Initialize the ACH client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!this.config.apiKey || !this.config.merchantId) {
      console.warn('[ACHClient] Missing credentials - ACH processing is disabled')
    }

    this.initialized = true
    console.log('[ACHClient] Initialized', {
      environment: this.config.environment,
      merchantId: this.config.merchantId ? '***' : 'not set'
    })
  }

  /**
   * Check if client is configured with valid credentials
   */
  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.merchantId)
  }

  /**
   * Get the current environment
   */
  getEnvironment(): 'sandbox' | 'production' {
    return this.config.environment
  }

  /**
   * Get the merchant ID
   */
  getMerchantId(): string {
    return this.config.merchantId
  }

  /**
   * Get webhook base URL
   */
  getWebhookBaseUrl(): string | undefined {
    return this.config.webhookBaseUrl
  }

  /**
   * Initiate an ACH debit (pull funds from account)
   *
   * @param amount - Amount in cents
   * @param accountId - Bank account identifier
   * @returns Transaction ID
   */
  async initiateDebit(amount: number, accountId: string): Promise<string> {
    void amount
    void accountId
    this.assertConfigured('initiateDebit')
    return this.throwUnsupported('initiateDebit')
  }

  /**
   * Initiate an ACH credit (push funds to account)
   *
   * @param amount - Amount in cents
   * @param accountId - Bank account identifier
   * @returns Transaction ID
   */
  async initiateCredit(amount: number, accountId: string): Promise<string> {
    void amount
    void accountId
    this.assertConfigured('initiateCredit')
    return this.throwUnsupported('initiateCredit')
  }

  /**
   * Check the status of an ACH transaction
   *
   * @param transactionId - Transaction identifier
   * @returns Current transaction status
   */
  async checkStatus(transactionId: string): Promise<ACHStatus> {
    void transactionId
    this.assertConfigured('checkStatus')
    return this.throwUnsupported('checkStatus')
  }

  /**
   * Cancel a pending ACH transaction
   *
   * @param transactionId - Transaction identifier
   * @throws Error if transaction cannot be cancelled
   */
  async cancelTransaction(transactionId: string): Promise<void> {
    void transactionId
    this.assertConfigured('cancelTransaction')
    this.throwUnsupported('cancelTransaction')
  }

  /**
   * Validate a bank account using routing and account numbers
   *
   * @param routingNumber - 9-digit ABA routing number
   * @param accountNumber - Bank account number
   * @returns Whether the account appears valid
   */
  async validateAccount(routingNumber: string, accountNumber: string): Promise<boolean> {
    // Always perform local format checks before requiring the provider.
    if (!this.validateRoutingNumber(routingNumber)) {
      console.log(`[ACHClient] validateAccount - invalid routing number`, { routingNumber })
      return false
    }

    if (!accountNumber || accountNumber.length < 4 || accountNumber.length > 17) {
      console.log(`[ACHClient] validateAccount - invalid account number length`)
      return false
    }

    this.assertConfigured('validateAccount')
    return this.throwUnsupported('validateAccount')
  }

  /**
   * Generate webhook URLs for ACH callbacks
   */
  generateWebhookUrls(): {
    statusWebhook?: string
    returnWebhook?: string
  } {
    const baseUrl = this.config.webhookBaseUrl
    if (!baseUrl) return {}

    return {
      statusWebhook: `${baseUrl}/api/webhooks/ach/status`,
      returnWebhook: `${baseUrl}/api/webhooks/ach/return`
    }
  }

  /**
   * Get transaction history for an account
   *
   * @param accountId - Bank account identifier
   * @param options - Optional filters for the transaction history
   * @returns Array of transactions for the account
   */
  async getTransactionHistory(
    accountId: string,
    options?: {
      startDate?: string
      endDate?: string
      status?: ACHStatus
      limit?: number
    }
  ): Promise<ACHTransaction[]> {
    void accountId
    void options
    this.assertConfigured('getTransactionHistory')
    return this.throwUnsupported('getTransactionHistory')
  }

  /**
   * Validate ABA routing number using checksum algorithm
   */
  private validateRoutingNumber(routing: string): boolean {
    // Must be exactly 9 digits
    if (!/^\d{9}$/.test(routing)) {
      return false
    }

    // ABA routing number checksum validation
    // Formula: 3(d1 + d4 + d7) + 7(d2 + d5 + d8) + (d3 + d6 + d9) mod 10 = 0
    const digits = routing.split('').map(Number)
    const checksum =
      3 * (digits[0] + digits[3] + digits[6]) +
      7 * (digits[1] + digits[4] + digits[7]) +
      (digits[2] + digits[5] + digits[8])

    return checksum % 10 === 0
  }

  private assertConfigured(operation: string): void {
    if (!this.isConfigured()) {
      throw new Error(`ACH client is not configured for ${operation}`)
    }
  }

  private throwUnsupported(operation: string): never {
    throw new Error(
      `ACHClient is not wired to a live provider for ${operation}. Configure a provider-specific implementation before enabling ACH operations.`
    )
  }
}

// Export singleton instance
export const achClient = new ACHClient()
