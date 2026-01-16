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
const DEFAULT_MAX_DELAY = 60000
const DEFAULT_JITTER_FACTOR = 0.5 // 50% jitter

// Anthropic constants
const ANTHROPIC_INITIAL_DELAY = 1000
const ANTHROPIC_MAX_DELAY = 60000 // 1 minute is reasonable for Anthropic

// Gemini constants
const GEMINI_INITIAL_DELAY = 1000
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

    // Exponential backoff: initial * 2^attempt
    // attempt is 1-based usually, so attempt 1 = initial * 2
    // If attempt is 0-based in caller, we should adjust. Assuming 1-based (1st retry).
    // Let's assume attempt=1 means first retry.

    const exponentialDelay = this.initialDelay * 2 ** (attempt - 1)

    // Apply jitter
    // delay = delay * (1 + jitter * (Math.random() * 2 - 1))
    // Or randomized between [delay, delay * (1 + jitter)]?
    // Standard "Full Jitter" is often random_between(0, min(cap, base * 2 ** attempt))
    // But requirement says "exponential + jitter".

    // Let's use a simple randomized jitter around the target delay
    const jitter = exponentialDelay * this.jitterFactor * (Math.random() * 2 - 1)
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
    if (!isNaN(seconds)) {
      return seconds * 1000
    }

    // Try parsing as Date
    const date = Date.parse(value)
    if (!isNaN(date)) {
      const ms = date - Date.now()
      return Math.max(0, ms)
    }

    return null
  }
}

export class AnthropicBackoffStrategy extends DefaultBackoffStrategy {
  constructor() {
    super(ANTHROPIC_INITIAL_DELAY, ANTHROPIC_MAX_DELAY)
  }

  getDelayMs(context: BackoffContext): number {
    // Anthropic specific logic if any different from default
    // They strongly recommend respecting retry-after headers.
    // Default implementation already does this.

    // Specifically check for 'retry-after' or 'x-should-retry-after' if Anthropic uses that (rarely).
    // Standard Retry-After is sufficient.

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
