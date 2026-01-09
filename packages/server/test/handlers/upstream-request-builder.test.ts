import { describe, expect, it, mock } from 'bun:test'
import {
  type RequestBuilderInput,
  buildUpstreamRequest,
} from '../../src/handlers/upstream-request-builder'
import { SignatureStore } from '../../src/stores'
import { createRetryState } from '../../src/handlers/request-handler'
import { clearProviders, registerProvider, OpenAIWebProvider, OpenAIProvider, AnthropicProvider, GeminiProvider, AntigravityProvider, OpencodeZenProvider } from '@llmux/core'

// Ensure providers are registered before tests run
clearProviders()
registerProvider(new OpenAIProvider())
registerProvider(new OpenAIWebProvider())
registerProvider(new AnthropicProvider())
registerProvider(new GeminiProvider())
registerProvider(new AntigravityProvider())
registerProvider(new OpencodeZenProvider())

describe('Upstream Request Builder', () => {
  const mockSignatureStore = new SignatureStore()

  it('builds a basic request for generic provider', async () => {
    const input: RequestBuilderInput = {
      reqId: 'test-req',
      body: { model: 'gpt-4o', messages: [] },
      options: {
        sourceFormat: 'openai-chat',
        targetProvider: 'openai',
        targetModel: 'gpt-4o',
        apiKey: 'dummy-key',
      },
      retryState: createRetryState(),
      mode: 'non-streaming',
      signatureStore: mockSignatureStore,
    }

    const result = await buildUpstreamRequest(input)

    expect(result.request.endpoint).toBe('https://api.openai.com/v1/chat/completions')
    expect(result.request.meta.provider).toBe('openai')
    expect(result.request.meta.model).toBe('gpt-4o')
    expect(result.request.init.method).toBe('POST')

    expect(result.request.init.headers).toHaveProperty('Authorization', 'Bearer dummy-key')

    expect(JSON.parse(result.request.init.body)).toHaveProperty('model', 'gpt-4o')
  })

  describe('OpenAI Web (Codex) provider', () => {
    const originalFetch = globalThis.fetch

    it('builds openai-web request with GitHub-fetched instructions', async () => {
      const input: RequestBuilderInput = {
        reqId: 'test-codex',
        body: {
          model: 'gpt-5.1',
          messages: [{ role: 'user', content: 'Hello' }],
          input: [{ role: 'user', content: 'Hello' }],
        },
        options: {
          sourceFormat: 'openai-chat',
          targetProvider: 'openai-web',
          targetModel: 'gpt-5.1',
          apiKey: 'test-key',
        },
        retryState: createRetryState(),
        mode: 'streaming',
        signatureStore: mockSignatureStore,
      }

      const result = await buildUpstreamRequest(input)

      // Verify Codex endpoint
      expect(result.request.endpoint).toBe('https://chatgpt.com/backend-api/codex/responses')
      expect(result.request.meta.provider).toBe('openai-web')
      expect(result.request.meta.model).toBe('gpt-5.1')

      // Verify request body structure
      const bodyObj = JSON.parse(result.request.init.body) as Record<string, unknown>

      // Verify instructions exist (either from GitHub or fallback)
      expect(typeof bodyObj.instructions).toBe('string')
      expect((bodyObj.instructions as string).length).toBeGreaterThan(0)

      // Verify input field exists (Codex format)
      expect(bodyObj).toHaveProperty('input')
      expect(Array.isArray(bodyObj.input)).toBe(true)

      // Verify stream flag
      expect(bodyObj.stream).toBe(true)

      globalThis.fetch = originalFetch
    })

    it('uses separate instructions field not custom system prompt', async () => {
      const input: RequestBuilderInput = {
        reqId: 'test-instructions-field',
        body: {
          model: 'gpt-5.1',
          messages: [{ role: 'user', content: 'Hello Oracle' }],
        },
        options: {
          sourceFormat: 'openai-chat',
          targetProvider: 'openai-web',
          targetModel: 'gpt-5.1',
          apiKey: 'test-key',
        },
        retryState: createRetryState(),
        mode: 'non-streaming',
        signatureStore: mockSignatureStore,
      }

      const result = await buildUpstreamRequest(input)
      const bodyObj = JSON.parse(result.request.init.body) as Record<string, unknown>

      // Critical: instructions field must exist and not be empty
      expect(bodyObj).toHaveProperty('instructions')
      const instructions = bodyObj.instructions as string
      expect(typeof instructions).toBe('string')
      expect(instructions.length).toBeGreaterThan(0)

      // Instructions should be Codex system prompts, not custom ones
      expect(instructions).not.toContain('Hello Oracle')

      // Input messages should only contain user messages, not system setup
      const inputMessages = bodyObj.input as Array<Record<string, unknown>>
      expect(Array.isArray(inputMessages)).toBe(true)
      expect(inputMessages.length).toBeGreaterThan(0)

      globalThis.fetch = originalFetch
    })

    it('handles streaming vs non-streaming mode for openai-web', async () => {
      globalThis.fetch = mock(async (url: string | URL) => {
        const urlStr = typeof url === 'string' ? url : url.toString()

        if (urlStr.includes('api.github.com')) {
          return new Response(JSON.stringify({ tag_name: 'v0.1.0' }), {
            status: 200,
          })
        }

        if (urlStr.includes('raw.githubusercontent.com')) {
          return new Response('Codex test', { status: 200 })
        }

        return new Response('Not found', { status: 404 })
      }) as unknown as typeof fetch

      // Test streaming mode
      const streamingInput: RequestBuilderInput = {
        reqId: 'test-stream',
        body: { model: 'gpt-5.1', messages: [{ role: 'user', content: 'Test' }] },
        options: {
          sourceFormat: 'openai-chat',
          targetProvider: 'openai-web',
          targetModel: 'gpt-5.1',
          apiKey: 'test-key',
        },
        retryState: createRetryState(),
        mode: 'streaming',
        signatureStore: mockSignatureStore,
      }

      const streamResult = await buildUpstreamRequest(streamingInput)
      const streamBody = JSON.parse(streamResult.request.init.body) as Record<string, unknown>
      expect(streamBody.stream).toBe(true)

      // Test non-streaming mode
      const nonStreamingInput: RequestBuilderInput = {
        ...streamingInput,
        mode: 'non-streaming',
      }

      const nonStreamResult = await buildUpstreamRequest(nonStreamingInput)
      const nonStreamBody = JSON.parse(nonStreamResult.request.init.body) as Record<string, unknown>
      expect(nonStreamBody.stream).toBe(true) // Codex always sets stream: true

      globalThis.fetch = originalFetch
    })
  })

  describe('originalModel propagation', () => {
    it('should preserve originalModel when explicitly provided via options', async () => {
      const input: RequestBuilderInput = {
        reqId: 'test-original-model',
        body: { model: 'claude-opus-4-5-thinking', messages: [] }, // Body has mapped model
        options: {
          sourceFormat: 'anthropic-messages',
          targetProvider: 'antigravity',
          targetModel: 'claude-opus-4-5-thinking', // Mapped model
          originalModel: 'claude-opus-4-5-20251101', // Original model from user request
          apiKey: 'dummy-key',
        },
        retryState: createRetryState(),
        mode: 'streaming',
        signatureStore: mockSignatureStore,
      }

      const result = await buildUpstreamRequest(input)

      // Critical: originalModel in meta should be the user's original request, not the mapped model
      expect(result.request.meta.originalModel).toBe('claude-opus-4-5-20251101')
      expect(result.request.meta.model).toBe('claude-opus-4-5-thinking')
    })

    it('should fallback to body.model when originalModel is not provided', async () => {
      const input: RequestBuilderInput = {
        reqId: 'test-no-original-model',
        body: { model: 'gpt-4o', messages: [] },
        options: {
          sourceFormat: 'openai-chat',
          targetProvider: 'openai',
          targetModel: 'gpt-4o',
          // No originalModel provided
          apiKey: 'dummy-key',
        },
        retryState: createRetryState(),
        mode: 'non-streaming',
        signatureStore: mockSignatureStore,
      }

      const result = await buildUpstreamRequest(input)

      // When no originalModel is provided, it should use body.model
      expect(result.request.meta.originalModel).toBe('gpt-4o')
      expect(result.request.meta.model).toBe('gpt-4o')
    })

    it('should use originalModel from options even when body.model differs', async () => {
      const input: RequestBuilderInput = {
        reqId: 'test-model-mismatch',
        body: { model: 'mapped-model-name', messages: [] }, // Body rewritten with mapped model
        options: {
          sourceFormat: 'anthropic-messages',
          targetProvider: 'openai',
          targetModel: 'mapped-model-name',
          originalModel: 'user-requested-model', // User's original request
          apiKey: 'dummy-key',
        },
        retryState: createRetryState(),
        mode: 'non-streaming',
        signatureStore: mockSignatureStore,
      }

      const result = await buildUpstreamRequest(input)

      // originalModel should be from options, NOT from body
      expect(result.request.meta.originalModel).toBe('user-requested-model')
    })
  })
})
