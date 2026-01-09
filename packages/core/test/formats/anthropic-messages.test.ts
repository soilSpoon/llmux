import { describe, test } from 'bun:test'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'
import {
  validateRequestRoundTrip,
  validateResponseRoundTrip,
  validateStreamRoundTrip,
} from './helpers'
import { AnthropicMessagesFixtures } from './fixtures/anthropic/index'

describe('Anthropic Messages Format', () => {
  const ctx = { provider: 'anthropic' as const, model: 'claude-3-opus-20240229' }

  describe('Requests', () => {
    test('should round-trip simple user message', () => {
      validateRequestRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.requests.simple,
        ctx
      )
    })

    test('should round-trip multimodal content', () => {
      validateRequestRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.requests.multipartContent,
        ctx
      )
    })

    test('should round-trip tool use (tool definitions)', () => {
      validateRequestRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.requests.withTools,
        ctx
      )
    })

    test('should round-trip tool result', () => {
      validateRequestRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.requests.withToolResult,
        ctx
      )
    })

    test('should round-trip system prompt', () => {
      validateRequestRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.requests.withSystem,
        ctx
      )
    })

    test('should round-trip config', () => {
      validateRequestRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.requests.withConfig,
        ctx
      )
    })
  })

  describe('Responses', () => {
    test('should round-trip simple response', () => {
      validateResponseRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.responses.simple,
        ctx
      )
    })

    test('should round-trip tool use response', () => {
      validateResponseRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.responses.withToolUse,
        ctx
      )
    })
  })

  describe('Streaming', () => {
    test('should parse and round-trip stream chunks', () => {
      validateStreamRoundTrip(
        AnthropicMessagesFormat,
        AnthropicMessagesFixtures.streaming.chunks,
        ctx,
        { text: 'Hello!' }
      )
    })
  })
})
