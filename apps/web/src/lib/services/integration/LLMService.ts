/**
 * LLM Service - Unified interface for Large Language Model providers
 * Supports: OpenAI, Anthropic, and local models
 */

import type { GenerativeConfig } from '@/types/generative'

export type LLMProvider = 'openai' | 'anthropic' | 'local'
export type LLMModel =
  | 'gpt-4'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'claude-3-opus'
  | 'claude-3-sonnet'
  | 'claude-3-haiku'
  | 'local-llama'

export interface LLMRequest {
  prompt: string
  systemPrompt?: string
  model?: LLMModel
  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
  stream?: boolean
}

export interface LLMResponse {
  text: string
  finishReason: 'stop' | 'length' | 'content_filter'
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  model: string
  cached?: boolean
}

export interface LLMStreamChunk {
  text: string
  isComplete: boolean
}

export interface CacheEntry {
  key: string
  response: LLMResponse
  timestamp: Date
  hits: number
}

class LLMService {
  private config: GenerativeConfig
  private cache: Map<string, CacheEntry> = new Map()
  private requestCount: number = 0
  private tokenCount: number = 0
  private dailyCost: number = 0

  constructor(config: GenerativeConfig) {
    this.config = config
    this.startCacheCleaner()
  }

  /**
   * Generate text completion
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Check cache first
    if (this.config.caching.enabled) {
      const cached = this.getCached(request)
      if (cached) {
        return { ...cached, cached: true }
      }
    }

    // Check rate limits
    this.checkRateLimits()

    // Route to appropriate provider
    const provider = this.config.llm.provider
    const model = request.model || this.config.llm.model

    let response: LLMResponse

    if (provider === 'openai') {
      response = await this.callOpenAI(request, model)
    } else if (provider === 'anthropic') {
      response = await this.callAnthropic(request, model)
    } else {
      response = await this.callLocalModel(request, model)
    }

    // Update metrics
    this.updateMetrics(response)

    // Cache if enabled
    if (this.config.caching.enabled) {
      this.setCached(request, response)
    }

    return response
  }

  /**
   * Stream text completion
   */
  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const provider = this.config.llm.provider
    const model = request.model || this.config.llm.model

    if (provider === 'openai') {
      yield* this.streamOpenAI(request, model)
    } else if (provider === 'anthropic') {
      yield* this.streamAnthropic(request, model)
    } else {
      // Local models don't support streaming in this implementation
      const response = await this.callLocalModel(request, model)
      yield { text: response.text, isComplete: true }
    }
  }

  /**
   * Generate embeddings for semantic search
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (this.config.llm.provider === 'openai') {
      return this.generateOpenAIEmbeddings(texts)
    } else {
      // Fallback to simple hash-based embeddings for non-OpenAI providers
      return this.generateSimpleEmbeddings(texts)
    }
  }

  /**
   * Calculate semantic similarity between two texts
   */
  async calculateSimilarity(text1: string, text2: string): Promise<number> {
    const [emb1, emb2] = await this.generateEmbeddings([text1, text2])
    return this.cosineSimilarity(emb1, emb2)
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Call OpenAI API
   */
  private async callOpenAI(request: LLMRequest, model: string): Promise<LLMResponse> {
    const apiKey = this.config.llm.apiKey || import.meta.env.VITE_OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured')
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
            { role: 'user', content: request.prompt }
          ],
          temperature: request.temperature ?? this.config.llm.temperature,
          max_tokens: request.maxTokens ?? this.config.llm.maxTokens,
          stop: request.stopSequences
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`)
      }

      const data = await response.json()
      const choice = data.choices[0]

      return {
        text: choice.message.content,
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        },
        model: data.model
      }
    } catch (error) {
      console.error('OpenAI API call failed:', error)
      throw error instanceof Error ? error : new Error('OpenAI API call failed')
    }
  }

  /**
   * Stream OpenAI API
   */
  private async *streamOpenAI(request: LLMRequest, model: string): AsyncGenerator<LLMStreamChunk> {
    const apiKey = this.config.llm.apiKey || import.meta.env.VITE_OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured')
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
            { role: 'user', content: request.prompt }
          ],
          temperature: request.temperature ?? this.config.llm.temperature,
          max_tokens: request.maxTokens ?? this.config.llm.maxTokens,
          stream: true
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              yield { text: '', isComplete: true }
              return
            }

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices[0]?.delta?.content
              if (delta) {
                yield { text: delta, isComplete: false }
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('OpenAI streaming failed:', error)
      throw error instanceof Error ? error : new Error('OpenAI streaming failed')
    }
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(request: LLMRequest, model: string): Promise<LLMResponse> {
    const apiKey = this.config.llm.apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY

    if (!apiKey) {
      throw new Error('Anthropic API key is not configured')
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? this.config.llm.maxTokens,
          messages: [{ role: 'user', content: request.prompt }],
          system: request.systemPrompt,
          temperature: request.temperature ?? this.config.llm.temperature,
          stop_sequences: request.stopSequences
        })
      })

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        text: data.content[0].text,
        finishReason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens
        },
        model: data.model
      }
    } catch (error) {
      console.error('Anthropic API call failed:', error)
      throw error instanceof Error ? error : new Error('Anthropic API call failed')
    }
  }

  /**
   * Stream Anthropic API
   */
  private async *streamAnthropic(
    request: LLMRequest,
    model: string
  ): AsyncGenerator<LLMStreamChunk> {
    const apiKey = this.config.llm.apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY

    if (!apiKey) {
      throw new Error('Anthropic API key is not configured')
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? this.config.llm.maxTokens,
          messages: [{ role: 'user', content: request.prompt }],
          system: request.systemPrompt,
          temperature: request.temperature ?? this.config.llm.temperature,
          stream: true
        })
      })

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta?.text
                if (delta) {
                  yield { text: delta, isComplete: false }
                }
              } else if (parsed.type === 'message_stop') {
                yield { text: '', isComplete: true }
                return
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Anthropic streaming failed:', error)
      throw error instanceof Error ? error : new Error('Anthropic streaming failed')
    }
  }

  /**
   * Call local model
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async callLocalModel(request: LLMRequest, model: string): Promise<LLMResponse> {
    throw new Error('Local model provider is not implemented')
  }

  /**
   * Generate OpenAI embeddings
   */
  private async generateOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
    const apiKey = this.config.llm.apiKey || import.meta.env.VITE_OPENAI_API_KEY

    if (!apiKey) {
      return this.generateSimpleEmbeddings(texts)
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: texts
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI Embeddings API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.data.map((item: { embedding: number[] }) => item.embedding)
    } catch (error) {
      console.error('OpenAI embeddings failed:', error)
      return this.generateSimpleEmbeddings(texts)
    }
  }

  /**
   * Simple hash-based embeddings (fallback)
   */
  private generateSimpleEmbeddings(texts: string[]): number[][] {
    // Simple TF-IDF-like embeddings for fallback
    const dimensions = 384 // Match common embedding size

    return texts.map((text) => {
      const words = text.toLowerCase().split(/\s+/)
      const embedding = new Array(dimensions).fill(0)

      words.forEach((word) => {
        const hash = this.hashString(word)
        const index = Math.abs(hash) % dimensions
        embedding[index] += 1 / Math.sqrt(words.length)
      })

      // Normalize
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
      return embedding.map((val) => val / (magnitude || 1))
    })
  }

  /**
   * Simple string hashing
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash
  }

  /**
   * Calculate cosine similarity between vectors
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must be same length')
    }

    let dotProduct = 0
    let mag1 = 0
    let mag2 = 0

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i]
      mag1 += vec1[i] * vec1[i]
      mag2 += vec2[i] * vec2[i]
    }

    mag1 = Math.sqrt(mag1)
    mag2 = Math.sqrt(mag2)

    if (mag1 === 0 || mag2 === 0) return 0

    return dotProduct / (mag1 * mag2)
  }

  /**
   * Cache management
   */
  private getCacheKey(request: LLMRequest): string {
    return `${request.model || 'default'}_${request.temperature || 0.7}_${this.hashString(
      request.prompt + (request.systemPrompt || '')
    )}`
  }

  private getCached(request: LLMRequest): LLMResponse | null {
    const key = this.getCacheKey(request)
    const entry = this.cache.get(key)

    if (!entry) return null

    const age = Date.now() - entry.timestamp.getTime()
    if (age > this.config.caching.ttl * 1000) {
      this.cache.delete(key)
      return null
    }

    entry.hits++
    return entry.response
  }

  private setCached(request: LLMRequest, response: LLMResponse): void {
    const key = this.getCacheKey(request)

    // Check cache size
    const maxEntries = Math.floor((this.config.caching.maxSize * 1024 * 1024) / 10000) // Rough estimate
    if (this.cache.size >= maxEntries) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries())
      entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime())
      for (let i = 0; i < Math.floor(maxEntries * 0.2); i++) {
        this.cache.delete(entries[i][0])
      }
    }

    this.cache.set(key, {
      key,
      response,
      timestamp: new Date(),
      hits: 0
    })
  }

  private startCacheCleaner(): void {
    setInterval(() => {
      const now = Date.now()
      const ttl = this.config.caching.ttl * 1000

      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp.getTime() > ttl) {
          this.cache.delete(key)
        }
      }
    }, 60000) // Clean every minute
  }

  /**
   * Rate limiting and metrics
   */
  private checkRateLimits(): void {
    this.requestCount++

    if (this.requestCount > this.config.rateLimits.requestsPerMinute) {
      throw new Error('Rate limit exceeded: requests per minute')
    }

    if (this.tokenCount > this.config.rateLimits.tokensPerDay) {
      throw new Error('Rate limit exceeded: tokens per day')
    }

    if (this.dailyCost > this.config.rateLimits.costLimitPerDay) {
      throw new Error('Rate limit exceeded: cost per day')
    }
  }

  private updateMetrics(response: LLMResponse): void {
    this.tokenCount += response.usage.totalTokens

    // Rough cost estimation (adjust based on actual pricing)
    const costPer1KTokens = 0.002 // $0.002 per 1K tokens (example)
    const cost = (response.usage.totalTokens / 1000) * costPer1KTokens
    this.dailyCost += cost
  }

  /**
   * Reset daily metrics (call at midnight)
   */
  resetDailyMetrics(): void {
    this.requestCount = 0
    this.tokenCount = 0
    this.dailyCost = 0
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      requestCount: this.requestCount,
      tokenCount: this.tokenCount,
      dailyCost: this.dailyCost,
      cacheSize: this.cache.size,
      cacheHitRate:
        Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.hits, 0) /
        Math.max(this.cache.size, 1)
    }
  }
}

// Export singleton instance
export const createLLMService = (config: GenerativeConfig) => new LLMService(config)

// Default configuration
export const defaultLLMConfig: GenerativeConfig = {
  llm: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.7,
    maxTokens: 2000
  },
  caching: {
    enabled: true,
    ttl: 3600, // 1 hour
    maxSize: 100 // 100 MB
  },
  rateLimits: {
    requestsPerMinute: 60,
    tokensPerDay: 1000000,
    costLimitPerDay: 100
  },
  quality: {
    minConfidenceThreshold: 0.7,
    requireHumanReview: false,
    enableFeedbackLoop: true
  }
}

export default LLMService
