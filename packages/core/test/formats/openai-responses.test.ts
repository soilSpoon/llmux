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
        blockType: 'thinking'
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
        blockType: 'text'
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

    test('should parse extended usage (reasoning_tokens, cached_tokens) from response.completed', () => {
      const chunk = `event: response.completed
data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
            output_tokens_details: {
              reasoning_tokens: 10
            },
            input_tokens_details: {
              cached_tokens: 20
            }
          }
        }
      })}\n\n`
      const result = parseStreamChunk(chunk)
      // Expecting array of chunks
      const chunks = Array.isArray(result) ? result : [result]
      const usageChunk = chunks.find(c => c.type === 'usage')
      
      expect(usageChunk).toMatchObject({
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          thinkingTokens: 10,
          cachedTokens: 20
        }
      })
    })

    test('should parse summary_index and content_index', () => {
      const thinkingChunk = `event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({
        type: 'response.reasoning_summary_text.delta',
        response_id: 'resp_1',
        output_index: 0,
        summary_index: 5,
        delta: ' thinking'
      })}\n\n`
      
      const resultThinking = parseStreamChunk(thinkingChunk)
      expect(resultThinking).toMatchObject({
        type: 'thinking',
        summaryIndex: 5
      })

      const contentChunk = `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: 'response.output_text.delta',
        response_id: 'resp_1',
        output_index: 0,
        content_index: 3,
        delta: ' content'
      })}\n\n`
      
      const resultContent = parseStreamChunk(contentChunk)
      expect(resultContent).toMatchObject({
        type: 'content',
        contentIndex: 3
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

    test('should round-trip extended usage (thinkingTokens, cachedTokens)', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          thinkingTokens: 10,
          cachedTokens: 20
        }
      }
      const sse = transformStreamChunk(chunk)
      expect(sse).toContain('event: response.completed')
      const parsed = JSON.parse(sse.split('data: ')[1]!.trim())
      expect(parsed.response.usage).toMatchObject({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        output_tokens_details: {
          reasoning_tokens: 10
        },
        input_tokens_details: {
          cached_tokens: 20
        }
      })
    })

    test('should round-trip summaryIndex and contentIndex', () => {
      // transformStreamChunk doesn't support summaryIndex/contentIndex directly in the builder yet
      // The builder handles it in OpenAIResponsesStreamingBuilder.
      // But we can test that the builder correctly emits events with these indices.
      
      const { OpenAIResponsesStreamingBuilder } = require('../../src/formats/openai-responses/streaming-builder')
      const builder = new OpenAIResponsesStreamingBuilder('gpt-4o')
      
      const thinkingChunk: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        summaryIndex: 5,
        delta: { thinking: { text: 'thinking', signature: 'test' } }
      }
      
      const thinkingEvents = builder.build(thinkingChunk)
      const thinkingEvent = thinkingEvents.find((e: string) => e.includes('response.reasoning_summary_text.delta'))
      expect(thinkingEvent).toBeDefined()
      if (thinkingEvent) {
        const data = JSON.parse(thinkingEvent.split('data: ')[1]!.trim())
        expect(data.summary_index).toBe(5)
      }
    })
  })
})
