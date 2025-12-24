/**
 * Streaming Integration Tests
 *
 * Tests:
 * 1. SSE chunk parsing for each provider
 * 2. SSE chunk transformation for each provider
 * 3. Round-trip streaming (parse → transform)
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { getProvider, registerProvider, clearProviders, type ProviderName } from '../src/providers'
import { OpenAIProvider } from '../src/providers/openai'
import { AnthropicProvider } from '../src/providers/anthropic'
import { GeminiProvider } from '../src/providers/gemini'
import { AntigravityProvider } from '../src/providers/antigravity'

beforeEach(() => {
  clearProviders()
  registerProvider(new OpenAIProvider())
  registerProvider(new AnthropicProvider())
  registerProvider(new GeminiProvider())
  registerProvider(new AntigravityProvider())
})

const providerNames: ProviderName[] = ['openai', 'anthropic', 'gemini', 'antigravity']

describe('Streaming: SSE Chunk Parsing', () => {
  describe.each(providerNames)('$name', (name) => {
    it('should parse content chunk', () => {
      const provider = getProvider(name)
      let chunk: string | null = null

      switch (name) {
        case 'openai':
          chunk = 'data: ' + JSON.stringify({
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: 1234567890,
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: { content: 'Test message' },
                finish_reason: null,
              },
            ],
          })
          break

        case 'anthropic':
          chunk = `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'Test message',
            },
          })}\n\n`
          break

        case 'gemini':
          chunk = 'data: ' + JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'Test message' }],
                },
              },
            ],
          })
          break

        case 'antigravity':
          chunk = 'data: ' + JSON.stringify({
            response: {
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: 'Test message' }],
                  },
                },
              ],
            },
          })
          break
      }

      const parsed = provider.parseStreamChunk!(chunk!)

      expect(parsed).toBeDefined()
      expect(parsed?.type).toBe('content')
      expect(parsed?.delta?.text).toBe('Test message')
    })

    it('should parse tool call chunk', () => {
      const provider = getProvider(name)
      let chunk: string | null = null

      switch (name) {
        case 'openai':
          chunk = 'data: ' + JSON.stringify({
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: 1234567890,
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_123',
                      function: {
                        name: 'test_tool',
                        arguments: '{"param":"value"}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })
          break

        case 'anthropic':
          chunk = `event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'call_123',
              name: 'test_tool',
              input: { param: 'value' },
            },
          })}\n\n`
          break

        case 'gemini':
          chunk = 'data: ' + JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'test_tool',
                        args: { param: 'value' },
                      },
                    },
                  ],
                },
              },
            ],
          })
          break

        case 'antigravity':
          chunk = 'data: ' + JSON.stringify({
            response: {
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [
                      {
                        functionCall: {
                          name: 'test_tool',
                          args: { param: 'value' },
                          id: 'call_123',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          })
          break
      }

      const parsed = provider.parseStreamChunk!(chunk!)

      expect(parsed).toBeDefined()
      expect(parsed?.type).toBe('tool_call')
      expect(parsed?.delta?.toolCall?.name).toBe('test_tool')
    })

    it('should parse thinking chunk', () => {
      const provider = getProvider(name)
      let chunk: string | null = null

      switch (name) {
        case 'openai':
          chunk = 'data: ' + JSON.stringify({
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: 1234567890,
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: { content: 'Thinking...' },
                finish_reason: null,
              },
            ],
          })
          break

        case 'anthropic':
          chunk = `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'thinking_delta',
              thinking: 'Thinking...',
            },
          })}\n\n`
          break

        case 'gemini':
          chunk = 'data: ' + JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    { thought: true, text: 'Thinking...', thoughtSignature: 'sig' },
                  ],
                },
              },
            ],
          })
          break

        case 'antigravity':
          chunk = 'data: ' + JSON.stringify({
            response: {
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [
                      { thought: true, text: 'Thinking...', thoughtSignature: 'sig' },
                    ],
                  },
                },
              ],
            },
          })
          break
      }

      const parsed = provider.parseStreamChunk!(chunk!)

      expect(parsed).toBeDefined()
      if (name === 'anthropic') {
        expect(parsed?.type).toBe('thinking')
        expect(parsed?.delta?.thinking?.text).toBe('Thinking...')
      } else {
        expect(parsed?.type).toMatch(/^(content|thinking)$/)
      }
    })

    it('should parse done chunk', () => {
      const provider = getProvider(name)
      let chunk: string | null = null

      switch (name) {
        case 'openai':
          chunk = 'data: [DONE]'
          break

        case 'anthropic':
          chunk = `event: message_stop\ndata: ${JSON.stringify({
            type: 'message_stop',
          })}\n\n`
          break

        case 'gemini':
          chunk = 'data: ' + JSON.stringify({
            candidates: [
              {
                content: { role: 'model', parts: [] },
                finishReason: 'STOP',
              },
            ],
          })
          break

        case 'antigravity':
          chunk = 'data: ' + JSON.stringify({
            response: {
              candidates: [
                {
                  content: { role: 'model', parts: [] },
                  finishReason: 'STOP',
                },
              ],
            },
          })
          break
      }

      const parsed = provider.parseStreamChunk!(chunk!)

      expect(parsed).toBeDefined()
      expect(parsed?.type).toBe('done')
    })
  })
})

describe('Streaming: SSE Chunk Transformation', () => {
  describe.each(providerNames)('$name', (name) => {
    it('should transform content chunk', () => {
      const provider = getProvider(name)
      const streamChunk = {
        type: 'content' as const,
        delta: {
          type: 'text' as const,
          text: 'Test message',
        },
      }

      const transformed = provider.transformStreamChunk!(streamChunk)

      expect(transformed).toBeDefined()
      expect(typeof transformed).toBe('string')
      expect(transformed.length).toBeGreaterThan(0)
    })

    it('should transform tool call chunk', () => {
      const provider = getProvider(name)
      const streamChunk = {
        type: 'tool_call' as const,
        delta: {
          type: 'tool_call' as const,
          toolCall: {
            id: 'call_123',
            name: 'test_tool',
            arguments: { param: 'value' },
          },
        },
      }

      const transformed = provider.transformStreamChunk!(streamChunk)

      expect(transformed).toBeDefined()
      expect(typeof transformed).toBe('string')
      expect(transformed.length).toBeGreaterThan(0)
    })

    it('should transform thinking chunk', () => {
      const provider = getProvider(name)
      const streamChunk = {
        type: 'thinking' as const,
        delta: {
          type: 'thinking' as const,
          thinking: {
            text: 'Thinking...',
          },
        },
      }

      const transformed = provider.transformStreamChunk!(streamChunk)

      expect(transformed).toBeDefined()
      expect(typeof transformed).toBe('string')
      expect(transformed.length).toBeGreaterThan(0)
    })

    it('should transform done chunk', () => {
      const provider = getProvider(name)
      const streamChunk = {
        type: 'done' as const,
        stopReason: 'end_turn' as const,
      }

      const transformed = provider.transformStreamChunk!(streamChunk)

      expect(transformed).toBeDefined()
      expect(typeof transformed).toBe('string')
      expect(transformed.length).toBeGreaterThan(0)
    })
  })
})

describe('Streaming: Round-trip', () => {
  describe.each(providerNames)('$name', (name) => {
    it('should handle content round-trip', () => {
      const provider = getProvider(name)
      const originalChunk = {
        type: 'content' as const,
        delta: {
          type: 'text' as const,
          text: 'Round-trip test',
        },
      }

      const sseChunk = provider.transformStreamChunk!(originalChunk)
      const parsed = provider.parseStreamChunk!(sseChunk)

      expect(parsed).toBeDefined()
      expect(parsed?.type).toBe('content')
    })

    it('should handle tool call round-trip', () => {
      const provider = getProvider(name)
      const originalChunk = {
        type: 'tool_call' as const,
        delta: {
          type: 'tool_call' as const,
          toolCall: {
            id: 'call_456',
            name: 'test_func',
            arguments: { key: 'value' },
          },
        },
      }

      const sseChunk = provider.transformStreamChunk!(originalChunk)
      const parsed = provider.parseStreamChunk!(sseChunk)

      expect(parsed).toBeDefined()
      expect(parsed?.type).toBe('tool_call')
    })
  })
})

describe('Streaming: Error Handling', () => {
  describe.each(providerNames)('$name', (name) => {
    it('should handle empty chunks', () => {
      const provider = getProvider(name)
      const parsed = provider.parseStreamChunk!('')
      expect(parsed).toBeNull()
    })

    it('should handle invalid JSON', () => {
      const provider = getProvider(name)
      const parsed = provider.parseStreamChunk!('invalid json')
      expect(parsed === null || parsed?.type === 'error').toBe(true)
    })
  })
})
