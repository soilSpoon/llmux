import { describe, expect, test } from 'bun:test'
import { GoogleGeminiFormat } from '../../src/formats/google-gemini'
import {
  validateRequestRoundTrip,
  validateResponseRoundTrip,
  validateStreamRoundTrip,
} from './helpers'
import { GoogleGeminiFixtures } from './fixtures/gemini/index'

describe('Google Gemini Format', () => {
  const ctx = { provider: 'gemini' as const, model: 'gemini-1.5-pro' }

  describe('Requests', () => {
    test('should round-trip simple user message', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.simple,
        ctx
      )
    })

    test('should round-trip multimodal content', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.multipartContent,
        ctx
      )
    })

    test('should round-trip tool use (definitions)', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withTools,
        ctx
      )
    })

    test('should round-trip tool results', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withToolResult,
        ctx
      )
    })

    test('should round-trip tool results with array response (wrapped in object)', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withToolResultArrayResponse,
        ctx
      )
    })

    test('should round-trip system prompt', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withSystem,
        ctx
      )
    })

    test('should round-trip config', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withConfig,
        ctx
      )
    })

    test('should resolve functionResponse name from functionCall.id when name is empty', () => {
      // This test ensures that when a client sends functionResponse with empty name,
      // the system resolves the name from the corresponding functionCall using the id
      const result = validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withToolResultEmptyName,
        ctx
      )
      
      // After round-trip, the functionResponse should have the correct name resolved
      const rebuilt = result.rebuilt as { contents: Array<{ parts: Array<{ functionResponse?: { name: string } }> }> }
      const functionResponsePart = rebuilt.contents[2]?.parts?.[0]
      expect(functionResponsePart?.functionResponse?.name).toBe('Read')
      
      const secondResponsePart = rebuilt.contents[2]?.parts?.[1]
      expect(secondResponsePart?.functionResponse?.name).toBe('glob')
    })

    test('should resolve functionResponse name by position when both name and id are empty (AMP scenario)', () => {
      // This is the real problematic scenario from AMP client
      // functionResponse has neither name NOR id - must match by position/index
      const result = validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withToolResultEmptyNameNoId,
        ctx
      )
      
      // After round-trip, the functionResponse should have names resolved by position
      const rebuilt = result.rebuilt as { contents: Array<{ parts: Array<{ functionResponse?: { name: string } }> }> }
      const functionResponsePart = rebuilt.contents[2]?.parts?.[0]
      expect(functionResponsePart?.functionResponse?.name).toBe('Read')
      
      const secondResponsePart = rebuilt.contents[2]?.parts?.[1]
      expect(secondResponsePart?.functionResponse?.name).toBe('glob')
    })

    test('should handle functionResponse without id (legacy format)', () => {
      validateRequestRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.requests.withToolResultNoId,
        ctx
      )
    })

    test('should propagate thinking signature to tool calls', () => {
      const input = {
        contents: [
          { role: 'user', parts: [{ text: 'Help me write code.' }] },
          {
            role: 'model',
            parts: [
              {
                thought: true,
                text: 'Thinking...',
                thoughtSignature: 'sig_1234567890',
              },
              {
                functionCall: {
                  name: 'list_files',
                  args: { dir: '.' },
                  id: 'call_1',
                },
              },
            ],
          },
        ],
      }

      const result = validateRequestRoundTrip(GoogleGeminiFormat, input as any, ctx)
      
      const rebuilt = result.rebuilt as any
      const rebuiltParts = rebuilt.contents[1].parts
      const toolCallPart = rebuiltParts.find((p: any) => p.functionCall)
      
      expect(toolCallPart).toBeDefined()
      expect(toolCallPart!.thoughtSignature).toBe('sig_1234567890')
      expect(toolCallPart!.thought_signature).toBe('sig_1234567890')
    })
  })

  describe('Responses', () => {
    test('should round-trip simple response', () => {
      validateResponseRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.responses.simple,
        ctx
      )
    })

    test('should round-trip tool call response', () => {
      validateResponseRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.responses.withToolCall,
        ctx
      )
    })
  })

  describe('Streaming', () => {
    test('should parse and round-trip stream chunks', () => {
      validateStreamRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.streaming.chunks,
        ctx,
        { text: 'Hello!' }
      )
    })

    test('should parse and round-trip tool call stream chunks', () => {
      const result = validateStreamRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.streaming.toolCallChunks,
        ctx
      )
      expect(result.toolCalls.length).toBeGreaterThan(0)
    })

    test('should handle thinking + functionCall in same chunk (extended thinking with tool use)', () => {
      const result = validateStreamRoundTrip(
        GoogleGeminiFormat,
        GoogleGeminiFixtures.streaming.thinkingWithToolCallChunks,
        ctx
      )
      // Should have both thinking and tool calls extracted
      expect(result.thinking.length).toBeGreaterThan(0)
      expect(result.toolCalls.length).toBeGreaterThan(0)
      expect(result.toolCalls[0]?.delta?.toolCall?.name).toBe('oracle')
    })
  })
})
