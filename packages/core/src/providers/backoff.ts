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
  getDelayMs({ attempt }: BackoffContext): number {
    return Math.min(1000 * 2 ** attempt, 30000)
  }
}

export class AnthropicBackoffStrategy implements BackoffStrategy {
  getDelayMs({ attempt, headers }: BackoffContext): number {
    if (headers) {
      const retryAfter = headers['retry-after'] || headers['Retry-After']
      if (retryAfter) {
        const seconds = parseInt(String(retryAfter), 10)
        if (!isNaN(seconds)) {
          return seconds * 1000
        }
      }
    }

    // Exponential backoff with jitter
    const delay = Math.min(1000 * 2 ** attempt, 60000)
    const jitter = Math.random() * 0.2 * delay // 20% jitter
    return delay + jitter
  }
}

export class GeminiBackoffStrategy implements BackoffStrategy {
  getDelayMs({ attempt }: BackoffContext): number {
    // Gemini benefits from faster retries but lower max delay
    return Math.min(500 * 2 ** attempt, 10000)
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
