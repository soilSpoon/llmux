import { describe, expect, it } from 'bun:test'
import { OpencodeZenStrategy } from '../../src/handlers/providers/opencode-zen-strategy'
import type { PrepareContextOptions, RetryState } from '../../src/handlers/providers/provider-strategy'

describe('OpencodeZenStrategy', () => {
  const strategy = new OpencodeZenStrategy()
  const baseRetryState: RetryState = {
    attempt: 0,
    accountIndex: 0,
    antigravityEndpointIndex: 0,
    overrideProjectId: null,
    maxRetryAttempts: 3,
  }

  describe('prepareContext', () => {
    it('returns openai endpoint for openai protocol models', async () => {
      const options: PrepareContextOptions = {
        model: 'glm-4.7-free',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-1',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.endpoint).toBe('https://opencode.ai/zen/v1/chat/completions')
    })

    it('returns anthropic endpoint for anthropic protocol models', async () => {
      const options: PrepareContextOptions = {
        model: 'claude-3-sonnet',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-2',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.endpoint).toBe('https://opencode.ai/zen/v1/messages')
    })

    it('returns model-specific endpoint for gemini-3-pro', async () => {
      const options: PrepareContextOptions = {
        model: 'gemini-3-pro',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-3',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.endpoint).toBe('https://opencode.ai/zen/v1/models/gemini-3-pro')
    })

    it('returns model-specific endpoint for gemini-3-flash', async () => {
      const options: PrepareContextOptions = {
        model: 'gemini-3-flash',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-4',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.endpoint).toBe('https://opencode.ai/zen/v1/models/gemini-3-flash')
    })

    it('returns model-specific endpoint for gemini-2.5-flash', async () => {
      const options: PrepareContextOptions = {
        model: 'gemini-2.5-flash',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-5',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.endpoint).toBe('https://opencode.ai/zen/v1/models/gemini-2.5-flash')
    })

    it('returns null for unknown models', async () => {
      const options: PrepareContextOptions = {
        model: 'unknown-model',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-6',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context).toBeNull()
    })

    it('returns provider name as opencode-zen', async () => {
      const options: PrepareContextOptions = {
        model: 'glm-4.7-free',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-7',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.provider).toBe('opencode-zen')
    })

    it('includes Content-Type header', async () => {
      const options: PrepareContextOptions = {
        model: 'glm-4.7-free',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-8',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.headers['Content-Type']).toBe('application/json')
    })

    it('sets accountIndex to 0', async () => {
      const options: PrepareContextOptions = {
        model: 'glm-4.7-free',
        accountIndex: 0,
        streaming: false,
        reqId: 'test-req-9',
      }

      const context = await strategy.prepareContext(options, baseRetryState)

      expect(context?.accountIndex).toBe(0)
    })
  })

  describe('adjustTransformedBody', () => {
    it('strips cache_control from body', () => {
      const body: Record<string, unknown> = {
        model: 'glm-4.7-free',
        messages: [],
        cache_control: { type: 'ephemeral' },
      }
      const meta = {
        thinking: false,
        provider: 'opencode-zen' as const,
        model: 'glm-4.7-free',
        thinkingEnabled: undefined,
      }

      const result = strategy.adjustTransformedBody(body, meta)

      expect(result.cache_control).toBeUndefined()
    })

    it('disables thinking for glm models when thinkingEnabled is false', () => {
      const body: Record<string, unknown> = {
        model: 'glm-4.7-free',
        messages: [],
      }
      const meta = {
        thinking: false,
        provider: 'opencode-zen' as const,
        model: 'glm-4.7-free',
        thinkingEnabled: false,
      }

      const result = strategy.adjustTransformedBody(body, meta)

      expect(result.thinking).toEqual({ type: 'disabled' })
    })

    it('removes reasoning_effort parameter', () => {
      const body: Record<string, unknown> = {
        model: 'glm-4.7-free',
        messages: [],
        reasoning_effort: 'high',
      }
      const meta = {
        thinking: false,
        provider: 'opencode-zen' as const,
        model: 'glm-4.7-free',
        thinkingEnabled: undefined,
      }

      const result = strategy.adjustTransformedBody(body, meta)

      expect(result.reasoning_effort).toBeUndefined()
    })
  })
})
