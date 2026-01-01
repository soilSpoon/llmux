import { describe, expect, test } from 'bun:test'
import {
  fixOpencodeZenBody,
  resolveOpencodeZenProtocol,
  getOpencodeZenEndpoint,
} from '../../src/providers/opencode-zen'

describe('opencode-zen provider', () => {
  describe('resolveOpencodeZenProtocol', () => {
    test('returns anthropic for claude models', () => {
      expect(resolveOpencodeZenProtocol('claude-3-sonnet')).toBe('anthropic')
      expect(resolveOpencodeZenProtocol('claude-haiku-4-5-20251001')).toBe('anthropic')
    })

    test('returns openai for glm models', () => {
      expect(resolveOpencodeZenProtocol('glm-4.7-free')).toBe('openai')
      expect(resolveOpencodeZenProtocol('glm-4.6')).toBe('openai')
    })

    test('returns openai for kimi models', () => {
      expect(resolveOpencodeZenProtocol('kimi-k2-thinking')).toBe('openai')
    })

    test('returns openai for grok models', () => {
      expect(resolveOpencodeZenProtocol('grok-3')).toBe('openai')
    })

    test('returns gemini for gemini models', () => {
      expect(resolveOpencodeZenProtocol('gemini-2.5-flash')).toBe('gemini')
    })

    test('returns null for unknown models', () => {
      expect(resolveOpencodeZenProtocol('unknown-model')).toBeNull()
    })
  })

  describe('getOpencodeZenEndpoint', () => {
    test('returns correct endpoints for each protocol', () => {
      expect(getOpencodeZenEndpoint('openai')).toBe('https://opencode.ai/zen/v1/chat/completions')
      expect(getOpencodeZenEndpoint('anthropic')).toBe('https://opencode.ai/zen/v1/messages')
      expect(getOpencodeZenEndpoint('gemini')).toBe('https://opencode.ai/zen/v1/generateContent')
    })
  })

  describe('fixOpencodeZenBody', () => {
    describe('thinking parameter handling for GLM models', () => {
      test('adds thinking: disabled when thinkingEnabled is false for glm model', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          messages: [{ role: 'user', content: 'Hello' }],
        }

        fixOpencodeZenBody(body, { thinkingEnabled: false })

        expect(body.thinking).toEqual({ type: 'disabled' })
      })

      test('adds thinking: disabled for kimi model when thinkingEnabled is false', () => {
        const body: Record<string, unknown> = {
          model: 'kimi-k2-thinking',
          messages: [{ role: 'user', content: 'Hello' }],
        }

        fixOpencodeZenBody(body, { thinkingEnabled: false })

        expect(body.thinking).toEqual({ type: 'disabled' })
      })

      test('does not add thinking for non-GLM models', () => {
        const body: Record<string, unknown> = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        }

        fixOpencodeZenBody(body, { thinkingEnabled: false })

        expect(body.thinking).toBeUndefined()
      })

      test('does not modify thinking when thinkingEnabled is true', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          messages: [{ role: 'user', content: 'Hello' }],
        }

        fixOpencodeZenBody(body, { thinkingEnabled: true })

        expect(body.thinking).toBeUndefined()
      })

      test('does not modify thinking when options are not provided', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          messages: [{ role: 'user', content: 'Hello' }],
        }

        fixOpencodeZenBody(body)

        expect(body.thinking).toBeUndefined()
      })
    })

    describe('reasoning_effort removal', () => {
      test('removes reasoning_effort parameter', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          messages: [{ role: 'user', content: 'Hello' }],
          reasoning_effort: 'none',
        }

        fixOpencodeZenBody(body)

        expect(body.reasoning_effort).toBeUndefined()
      })
    })

    describe('cache_control removal (beta fields)', () => {
      test('removes cache_control from top level', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          cache_control: { type: 'ephemeral' },
        }

        fixOpencodeZenBody(body)

        expect(body.cache_control).toBeUndefined()
      })

      test('removes cache_control from nested objects', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          messages: [
            {
              role: 'user',
              content: 'Hello',
              cache_control: { type: 'ephemeral' },
            },
          ],
        }

        fixOpencodeZenBody(body)

        const messages = body.messages as Array<{ cache_control?: unknown }>
        expect(messages[0]?.cache_control).toBeUndefined()
      })
    })

    describe('tools transformation', () => {
      test('transforms Anthropic tool format to OpenAI function format', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          tools: [
            {
              name: 'set_title',
              description: 'Set a title',
              input_schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                },
                required: ['title'],
              },
            },
          ],
        }

        fixOpencodeZenBody(body)

        expect(body.tools).toEqual([
          {
            type: 'function',
            function: {
              name: 'set_title',
              description: 'Set a title',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                },
                required: ['title'],
              },
            },
          },
        ])
      })

      test('does not transform tools already in OpenAI format', () => {
        const openaiTools = [
          {
            type: 'function',
            function: {
              name: 'set_title',
              parameters: { type: 'object' },
            },
          },
        ]
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          tools: openaiTools,
        }

        fixOpencodeZenBody(body)

        // Should remain unchanged (no input_schema means not Anthropic format)
        expect(body.tools).toEqual(openaiTools)
      })
    })

    describe('combined scenarios', () => {
      test('handles GLM model with tools and thinking disabled', () => {
        const body: Record<string, unknown> = {
          model: 'glm-4.7-free',
          messages: [{ role: 'user', content: 'Set title' }],
          reasoning_effort: 'medium',
          tools: [
            {
              name: 'set_title',
              input_schema: {
                type: 'object',
                properties: { title: { type: 'string' } },
              },
            },
          ],
          tool_choice: { type: 'tool', name: 'set_title' },
        }

        fixOpencodeZenBody(body, { thinkingEnabled: false })

        expect(body.thinking).toEqual({ type: 'disabled' })
        expect(body.reasoning_effort).toBeUndefined()
        expect(body.tools).toEqual([
          {
            type: 'function',
            function: {
              name: 'set_title',
              description: undefined,
              parameters: {
                type: 'object',
                properties: { title: { type: 'string' } },
              },
            },
          },
        ])
      })
    })
  })
})
