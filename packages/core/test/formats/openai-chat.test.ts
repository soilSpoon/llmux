import { describe, expect, test } from 'bun:test'
import { OpenAIChatFormat } from '../../src/formats/openai-chat'
import {
  validateRequestRoundTrip,
  validateResponseRoundTrip,
  validateStreamRoundTrip,
} from './helpers'
import { OpenAIChatFixtures } from './fixtures/openai-chat'

describe('OpenAI Chat Format', () => {
  const ctx = { provider: 'openai' as const, model: 'gpt-4o' }

  describe('Requests', () => {
    test('should round-trip simple user message', () => {
      validateRequestRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.requests.simple,
        ctx
      )
    })

    test('should round-trip multimodal content', () => {
      validateRequestRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.requests.multipartContent,
        ctx
      )
    })

    test('should round-trip tool calls', () => {
      validateRequestRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.requests.withTools,
        ctx
      )
    })

    test('should round-trip tool results', () => {
      validateRequestRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.requests.withToolResult,
        ctx
      )
    })

    test('should round-trip system prompt', () => {
      validateRequestRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.requests.withSystem,
        ctx
      )
    })

    test('should round-trip request with config', () => {
      validateRequestRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.requests.withConfig,
        ctx
      )
    })
  })

  describe('Responses', () => {
    test('should round-trip simple response', () => {
      validateResponseRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.responses.simple,
        ctx
      )
    })

    test('should round-trip tool call response', () => {
      validateResponseRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.responses.withToolCall,
        ctx
      )
    })
  })

  describe('Streaming', () => {
    test('should parse and round-trip stream chunks', () => {
      validateStreamRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.streaming.chunks,
        ctx,
        { text: 'Hello!' }
      )
    })

    test('should parse and round-trip tool call stream chunks', () => {
      const result = validateStreamRoundTrip(
        OpenAIChatFormat,
        OpenAIChatFixtures.streaming.toolCallChunks,
        ctx
      )
      expect(result.toolCalls.length).toBeGreaterThan(0)
    })
  })
})
