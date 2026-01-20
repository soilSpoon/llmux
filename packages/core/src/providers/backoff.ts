import type { UnifiedError } from '../types/error'
import type { ProviderName } from '../types/providers'

export interface BackoffContext {
  attempt: number
  error?: UnifiedError
  headers?: Record<string, string>
}

export interface BackoffStrategy {
  getDelayMs(context: BackoffContext): number
}

// Default constants
const DEFAULT_INITIAL_DELAY = 1000
const DEFAULT_MAX_DELAY = 30000
const DEFAULT_JITTER_FACTOR = 0

// Anthropic constants
const ANTHROPIC_INITIAL_DELAY = 1000
const ANTHROPIC_MAX_DELAY = 30000
const ANTHROPIC_JITTER_FACTOR = 0.2

// Gemini constants
const GEMINI_INITIAL_DELAY = 500
const GEMINI_MAX_DELAY = 10000 // 10 seconds max for Gemini usually

export class DefaultBackoffStrategy implements BackoffStrategy {
  constructor(
    protected initialDelay: number = DEFAULT_INITIAL_DELAY,
    protected maxDelay: number = DEFAULT_MAX_DELAY,
    protected jitterFactor: number = DEFAULT_JITTER_FACTOR
  ) {}

  getDelayMs(context: BackoffContext): number {
    const { attempt } = context

    // Check Retry-After header first (common standard)
    const retryAfter = this.parseRetryAfter(context.headers)
    if (retryAfter !== null) {
      return retryAfter
    }

    // Exponential backoff: initial * 2^attempt (attempt is 0-based)
    const exponentialDelay = this.initialDelay * 2 ** attempt

    // Apply optional jitter (positive-only for predictability in tests)
    const jitter = exponentialDelay * this.jitterFactor * Math.random()
    const delay = exponentialDelay + jitter

    // Clamp to max delay
    return Math.min(Math.max(0, delay), this.maxDelay)
  }

  protected parseRetryAfter(headers?: Record<string, string>): number | null {
    if (!headers) return null

    // Case-insensitive lookup
    const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'retry-after')
    if (!headerKey) return null

    const value = headers[headerKey]
    if (!value) return null

    // value can be seconds or HTTP date
    // Try parsing as number (seconds)
    const seconds = Number(value)
    if (!Number.isNaN(seconds)) {
      return seconds * 1000
    }

    // Try parsing as Date
    const date = Date.parse(value)
    if (!Number.isNaN(date)) {
      const ms = date - Date.now()
      return Math.max(0, ms)
    }

    return null
  }
}

export class AnthropicBackoffStrategy extends DefaultBackoffStrategy {
  constructor() {
    super(ANTHROPIC_INITIAL_DELAY, ANTHROPIC_MAX_DELAY, ANTHROPIC_JITTER_FACTOR)
  }

  getDelayMs(context: BackoffContext): number {
    return super.getDelayMs(context)
  }
}

export class GeminiBackoffStrategy extends DefaultBackoffStrategy {
  constructor() {
    // Gemini often prefers faster retries or shorter timeouts
    super(GEMINI_INITIAL_DELAY, GEMINI_MAX_DELAY)
  }
}

export function getBackoffStrategy(provider: ProviderName): BackoffStrategy {
  switch (provider) {
    case 'anthropic':
      return new AnthropicBackoffStrategy()
    case 'google':
    case 'gemini':
    case 'gemini-cli':
      return new GeminiBackoffStrategy()
    default:
      return new DefaultBackoffStrategy()
  }
}
