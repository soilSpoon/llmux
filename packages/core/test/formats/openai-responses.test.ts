import { describe, test, expect } from 'bun:test'
import { OpenAIResponsesFormat } from '../../src/formats/openai-responses'
import type { StreamChunk } from '../../src/types/unified'
import { validateRequestRoundTrip, validateResponseRoundTrip } from './helpers'
import { OpenAIResponsesFixtures } from './fixtures/openai-responses'

describe('OpenAI Responses Format', () => {
  const ctx = { provider: 'openai' as const, model: 'gpt-4o' }

  describe('Requests', () => {
    test('should round-trip simple input_text', () => {
      validateRequestRoundTrip(
        OpenAIResponsesFormat,
        OpenAIResponsesFixtures.requests.simple,
        ctx
      )
    })

    test('should round-trip instructions', () => {
      validateRequestRoundTrip(
        OpenAIResponsesFormat,
        OpenAIResponsesFixtures.requests.withInstructions,
        ctx
      )
    })

    test('should round-trip tool calls', () => {
      validateRequestRoundTrip(
        OpenAIResponsesFormat,
        OpenAIResponsesFixtures.requests.withToolCall,
        ctx
      )
    })

    test('should round-trip tool results', () => {
      validateRequestRoundTrip(
        OpenAIResponsesFormat,
        OpenAIResponsesFixtures.requests.withToolResult,
        ctx
      )
    })
  })

  describe('Responses', () => {
    test('should round-trip simple response', () => {
      validateResponseRoundTrip(
        OpenAIResponsesFormat,
        OpenAIResponsesFixtures.responses.simple,
        ctx
      )
    })
  })

  describe('Parsing', () => {
    const { parseStreamChunk } = require('../../src/formats/openai-responses/streaming')

    test('should parse response.content_part.added', () => {
      const chunk = `event: response.content_part.added\ndata: ${JSON.stringify({
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text' }
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {}
      })
    })

    test('should parse response.content_part.done', () => {
      const chunk = `event: response.content_part.done\ndata: ${JSON.stringify({
        type: 'response.content_part.done',
        output_index: 0,
        content_index: 0
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'block_stop',
        blockIndex: 0,
        blockType: 'text'
      })
    })

    test('should parse response.reasoning_summary_part.added', () => {
      const chunk = `event: response.reasoning_summary_part.added\ndata: ${JSON.stringify({
        type: 'response.reasoning_summary_part.added',
        output_index: 0,
        part: { type: 'summary_text' }
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'thinking-start',
        blockIndex: 0,
        blockType: 'thinking'
      })
    })

    test('should parse response.reasoning_summary_part.done', () => {
      const chunk = `event: response.reasoning_summary_part.done\ndata: ${JSON.stringify({
        type: 'response.reasoning_summary_part.done',
        output_index: 0
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'thinking-end',
        blockIndex: 0,
        blockType: 'thinking'
      })
    })

    test('should parse response.reasoning_summary_text.done', () => {
      const chunk = `event: response.reasoning_summary_text.done\ndata: ${JSON.stringify({
        type: 'response.reasoning_summary_text.done',
        output_index: 0,
        text: 'Full thought'
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'thinking-end',
        blockIndex: 0,
        delta: { thinking: { text: 'Full thought' } }
      })
    })

    test('should parse response.output_text.done', () => {
      const chunk = `event: response.output_text.done\ndata: ${JSON.stringify({
        type: 'response.output_text.done',
        output_index: 0,
        text: 'Full response'
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'block_stop',
        blockIndex: 0,
        delta: { text: 'Full response' }
      })
    })

    test('should extract extended metadata from response.created', () => {
      const chunk = `event: response.created\ndata: ${JSON.stringify({
        response: {
          id: 'resp_123',
          object: 'chat.completion',
          created_at: 1234567890,
          model: 'gpt-4o',
          status: 'in_progress',
          max_tool_calls: 5,
          previous_response_id: 'resp_prev_123',
          prompt_cache_retention: 3600
        }
      })}\n\n`
      const result = parseStreamChunk(chunk)
      expect(result).toMatchObject({
        type: 'done',
        skipStopDelta: true,
        responseMetadata: {
          responseId: 'resp_123',
          maxToolCalls: 5,
          previousResponseId: 'resp_prev_123',
          promptCacheRetention: 3600
        }
      })
    })

    test('should parse metadata (sequence_number, obfuscation) from response.output_text.delta', () => {
      const chunk = `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: 'response.output_text.delta',
        output_index: 0,
        delta: 'Hello',
        sequence_number: 42,
        obfuscation: {
          type: 'masked',
          reason: 'pii'
        }
      })}\n\n`
      const result = parseStreamChunk(chunk)
      // Expecting metadata to be passed through in the delta or chunk
      // Adjust expectation based on implementation goal. Assuming it goes into delta for now.
      expect(result).toMatchObject({
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        sequenceNumber: 42,
        obfuscation: {
          type: 'masked',
          reason: 'pii'
        },
        delta: {
          type: 'text',
          text: 'Hello'
        }
      })
    })
  })

  describe('Round-trip Conversion', () => {
    const { transformStreamChunk } = require('../../src/formats/openai-responses/streaming')

    test('should round-trip text delta', () => {
      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' }
      }
      const sse = transformStreamChunk(chunk)
      expect(sse).toContain('event: response.output_text.delta')
      expect(sse).toContain('"delta":"Hello"')
    })

    test('should round-trip thinking-start', () => {
      const chunk: StreamChunk = {
        type: 'thinking-start',
        blockIndex: 0,
        blockType: 'thinking'
      }
      const sse = transformStreamChunk(chunk)
      expect(sse).toContain('event: response.reasoning_summary_part.added')
    })
  })
})
