import type { ProviderName } from '../types/providers'

export interface BackoffStrategy {
  getDelayMs(context: BackoffContext): number
}

export interface BackoffContext {
  attempt: number
  error?: unknown
  headers?: Record<string, string | string[] | undefined>
}

export class DefaultBackoffStrategy implements BackoffStrategy {
  getDelayMs({ attempt, headers }: BackoffContext): number {
    // Check Retry-After header first
    if (headers) {
      // Find case-insensitive 'retry-after' header
      const retryAfterKey = Object.keys(headers).find((key) => key.toLowerCase() === 'retry-after')
      const retryAfter = retryAfterKey ? headers[retryAfterKey] : undefined

      if (retryAfter) {
        // Try parsing as seconds
        const seconds = parseInt(String(retryAfter), 10)
        if (!isNaN(seconds)) {
          return seconds * 1000
        }

        // Try parsing as HTTP Date
        const date = Date.parse(String(retryAfter))
        if (!isNaN(date)) {
          const now = Date.now()
          const diff = date - now
          return Math.max(diff, 0)
        }
      }
    }

    // Default exponential backoff: 1000, 2000, 4000, 8000...
    return Math.min(1000 * 2 ** (attempt - 1), 30000)
  }
}

export class AnthropicBackoffStrategy implements BackoffStrategy {
  getDelayMs({ attempt, headers }: BackoffContext): number {
    // Check Retry-After header first (case-insensitive)
    if (headers) {
      const retryAfterKey = Object.keys(headers).find((key) => key.toLowerCase() === 'retry-after')
      const retryAfter = retryAfterKey ? headers[retryAfterKey] : undefined

      if (retryAfter) {
        const seconds = parseInt(String(retryAfter), 10)
        if (!isNaN(seconds)) {
          return seconds * 1000
        }
      }
    }

    // Exponential backoff with jitter
    const delay = Math.min(1000 * 2 ** (attempt - 1), 60000)
    const jitter = Math.random() * 0.2 * delay // 20% jitter
    return delay + jitter
  }
}

export class GeminiBackoffStrategy implements BackoffStrategy {
  getDelayMs({ attempt }: BackoffContext): number {
    // Gemini benefits from faster retries but lower max delay
    return Math.min(500 * 2 ** (attempt - 1), 10000)
  }
}

const strategies: Record<string, BackoffStrategy> = {
  default: new DefaultBackoffStrategy(),
  anthropic: new AnthropicBackoffStrategy(),
  gemini: new GeminiBackoffStrategy(),
  'gemini-cli': new GeminiBackoffStrategy(),
  google: new GeminiBackoffStrategy(),
}

const defaultStrategy = new DefaultBackoffStrategy()

export function getBackoffStrategy(provider: ProviderName): BackoffStrategy {
  return strategies[provider] ?? defaultStrategy
}
