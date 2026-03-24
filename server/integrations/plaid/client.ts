/**
 * Plaid API Client
 *
 * Base client for Plaid integration with environment configuration.
 * Supports sandbox, development, and production environments.
 *
 * @see https://plaid.com/docs/
 * @module server/integrations/plaid/client
 */

/**
 * Plaid environment types
 */
export type PlaidEnvironment = 'sandbox' | 'development' | 'production'

/**
 * Plaid client configuration
 */
export interface PlaidClientConfig {
  clientId: string
  secret: string
  environment: PlaidEnvironment
}

/**
 * Plaid API base URLs by environment
 */
const PLAID_BASE_URLS: Record<PlaidEnvironment, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com'
}

/**
 * Generic Plaid API response structure
 */
export interface PlaidApiResponse<T> {
  data: T
  requestId: string
}

/**
 * Plaid error structure
 */
export interface PlaidError {
  errorType: string
  errorCode: string
  errorMessage: string
  displayMessage?: string
  requestId?: string
}

/**
 * Check if an error is a Plaid error
 */
export function isPlaidError(error: unknown): error is PlaidError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errorType' in error &&
    'errorCode' in error &&
    'errorMessage' in error
  )
}

/**
 * Plaid client for API interactions.
 *
 * Provides authenticated access to Plaid API endpoints with proper
 * environment configuration and error handling.
 *
 * @example
 * ```typescript
 * const client = new PlaidClient({
 *   clientId: 'your-client-id',
 *   secret: 'your-secret',
 *   environment: 'sandbox'
 * })
 *
 * const response = await client.makeRequest('/link/token/create', {
 *   user: { client_user_id: 'user-123' },
 *   client_name: 'MCA Platform',
 *   products: ['transactions'],
 *   country_codes: ['US'],
 *   language: 'en'
 * })
 * ```
 */
export class PlaidClient {
  private readonly clientId: string
  private readonly secret: string
  private readonly environment: PlaidEnvironment
  private readonly baseUrl: string

  constructor(clientConfig?: Partial<PlaidClientConfig>) {
    // Get config from environment variables or provided config
    this.clientId = clientConfig?.clientId || process.env.PLAID_CLIENT_ID || ''
    this.secret = clientConfig?.secret || process.env.PLAID_SECRET || ''
    this.environment = (clientConfig?.environment ||
      process.env.PLAID_ENV ||
      'sandbox') as PlaidEnvironment
    this.baseUrl = PLAID_BASE_URLS[this.environment]
  }

  /**
   * Get the current environment
   */
  getEnvironment(): PlaidEnvironment {
    return this.environment
  }

  /**
   * Get the base URL for the current environment
   */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * Check if the client is configured with credentials
   */
  isConfigured(): boolean {
    return Boolean(this.clientId && this.secret)
  }

  /**
   * Make an authenticated request to the Plaid API.
   *
   * @param endpoint - The API endpoint (e.g., '/link/token/create')
   * @param body - Request body
   * @returns API response
   * @throws {PlaidError} If the API returns an error
   *
   */
  async makeRequest<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<PlaidApiResponse<T>> {
    if (!this.isConfigured()) {
      throw this.createError(
        'INVALID_CONFIGURATION',
        'MISSING_CREDENTIALS',
        'Plaid client is not configured with credentials'
      )
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': this.clientId,
        'PLAID-SECRET': this.secret,
        'Plaid-Version': '2020-09-14'
      },
      body: JSON.stringify(body)
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw this.createError(
        typeof payload.error_type === 'string' ? payload.error_type : 'API_ERROR',
        typeof payload.error_code === 'string' ? payload.error_code : 'PLAID_REQUEST_FAILED',
        typeof payload.error_message === 'string'
          ? payload.error_message
          : `Plaid request failed with status ${response.status}`
      )
    }

    return {
      data: payload as T,
      requestId: typeof payload.request_id === 'string' ? payload.request_id : `plaid-${Date.now()}`
    }
  }

  /**
   * Create a Plaid error object
   */
  private createError(errorType: string, errorCode: string, errorMessage: string): PlaidError {
    return {
      errorType,
      errorCode,
      errorMessage,
      requestId: `plaid-${Date.now()}`
    }
  }
}

/**
 * Default Plaid client instance using environment configuration
 */
export const plaidClient = new PlaidClient()

/**
 * Create a new Plaid client with custom configuration
 */
export function createPlaidClient(clientConfig: PlaidClientConfig): PlaidClient {
  return new PlaidClient(clientConfig)
}
