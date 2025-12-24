import { describe, expect, it } from 'bun:test'
import { parseResponse, transformResponse } from '../../../src/providers/anthropic/response'
import type { UnifiedResponse, ContentPart } from '../../../src/types/unified'
import type { AnthropicResponse } from '../../../src/providers/anthropic/types'
import { createUnifiedResponse } from '../_utils/fixtures'

describe('Anthropic Response Transformations', () => {
  describe('parseResponse (AnthropicResponse → UnifiedResponse)', () => {
    it('should parse a simple text response', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Hello! How can I help you?' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 15,
        },
      }

      const result = parseResponse(anthropic)

      expect(result.id).toBe('msg_123')
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBe('Hello! How can I help you?')
      expect(result.stopReason).toBe('end_turn')
      expect(result.model).toBe('claude-sonnet-4-20250514')
    })

    it('should parse usage information', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      }

      const result = parseResponse(anthropic)

      expect(result.usage?.inputTokens).toBe(100)
      expect(result.usage?.outputTokens).toBe(50)
      expect(result.usage?.totalTokens).toBe(150)
      expect(result.usage?.cachedTokens).toBe(50) // cache_creation + cache_read
    })

    it('should parse tool_use content blocks', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          { type: 'text', text: 'Let me check the weather.' },
          {
            type: 'tool_use',
            id: 'toolu_01T1x1fJ34qAmk2tNTrN7Up6',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 30 },
      }

      const result = parseResponse(anthropic)

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('text')
      expect(result.content[1].type).toBe('tool_call')
      expect(result.content[1].toolCall?.id).toBe('toolu_01T1x1fJ34qAmk2tNTrN7Up6')
      expect(result.content[1].toolCall?.name).toBe('get_weather')
      expect(result.content[1].toolCall?.arguments).toEqual({ location: 'San Francisco' })
      expect(result.stopReason).toBe('tool_use')
    })

    it('should parse thinking content blocks', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me analyze this step by step...',
            signature: 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk',
          },
          { type: 'text', text: 'Based on my analysis...' },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 100 },
      }

      const result = parseResponse(anthropic)

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('thinking')
      expect(result.content[0].thinking?.text).toBe('Let me analyze this step by step...')
      expect(result.content[0].thinking?.signature).toBe(
        'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk'
      )
    })

    it('should populate thinking array in response', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'thinking',
            thinking: 'First thought...',
            signature: 'sig1',
          },
          {
            type: 'thinking',
            thinking: 'Second thought...',
            signature: 'sig2',
          },
          { type: 'text', text: 'Final answer.' },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 100 },
      }

      const result = parseResponse(anthropic)

      expect(result.thinking).toHaveLength(2)
      expect(result.thinking![0].text).toBe('First thought...')
      expect(result.thinking![0].signature).toBe('sig1')
      expect(result.thinking![1].text).toBe('Second thought...')
    })

    it('should parse redacted_thinking blocks', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'redacted_thinking',
            data: 'encrypted_data_here',
          },
          { type: 'text', text: 'Final answer.' },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 100 },
      }

      const result = parseResponse(anthropic)

      // Redacted thinking should be filtered or handled appropriately
      expect(result.content.some((c) => c.type === 'text')).toBe(true)
    })

    it('should handle stop_reason mappings', () => {
      const testCases: Array<{
        anthropicReason: AnthropicResponse['stop_reason']
        expectedReason: UnifiedResponse['stopReason']
      }> = [
        { anthropicReason: 'end_turn', expectedReason: 'end_turn' },
        { anthropicReason: 'max_tokens', expectedReason: 'max_tokens' },
        { anthropicReason: 'tool_use', expectedReason: 'tool_use' },
        { anthropicReason: 'stop_sequence', expectedReason: 'stop_sequence' },
        { anthropicReason: null, expectedReason: null },
      ]

      for (const { anthropicReason, expectedReason } of testCases) {
        const anthropic: AnthropicResponse = {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: anthropicReason,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }

        const result = parseResponse(anthropic)
        expect(result.stopReason).toBe(expectedReason)
      }
    })

    it('should handle multiple tool_use blocks', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'get_weather',
            input: { location: 'NYC' },
          },
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'get_time',
            input: { timezone: 'EST' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 40 },
      }

      const result = parseResponse(anthropic)

      expect(result.content).toHaveLength(2)
      expect(result.content[0].toolCall?.id).toBe('toolu_1')
      expect(result.content[1].toolCall?.id).toBe('toolu_2')
    })
  })

  describe('transformResponse (UnifiedResponse → AnthropicResponse)', () => {
    it('should transform a simple text response', () => {
      const unified = createUnifiedResponse({
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        model: 'claude-sonnet-4-20250514',
      })

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.id).toBe('msg_123')
      expect(result.type).toBe('message')
      expect(result.role).toBe('assistant')
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect((result.content[0] as any).text).toBe('Hello!')
      expect(result.stop_reason).toBe('end_turn')
    })

    it('should generate id if not present', () => {
      const unified = createUnifiedResponse({
        id: '',
        content: [{ type: 'text', text: 'Hello!' }],
      })

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.id).toMatch(/^msg_/)
    })

    it('should transform usage information', () => {
      const unified = createUnifiedResponse({
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      })

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.usage.input_tokens).toBe(100)
      expect(result.usage.output_tokens).toBe(50)
    })

    it('should transform tool_call content parts to tool_use blocks', () => {
      const unified: UnifiedResponse = {
        id: 'msg_123',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'toolu_123',
              name: 'get_weather',
              arguments: { location: 'NYC' },
            },
          },
        ],
        stopReason: 'tool_use',
      }

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('text')
      expect(result.content[1].type).toBe('tool_use')
      expect((result.content[1] as any).id).toBe('toolu_123')
      expect((result.content[1] as any).name).toBe('get_weather')
      expect((result.content[1] as any).input).toEqual({ location: 'NYC' })
    })

    it('should transform thinking content parts', () => {
      const unified: UnifiedResponse = {
        id: 'msg_123',
        content: [
          {
            type: 'thinking',
            thinking: {
              text: 'Let me analyze...',
              signature: 'sig123',
            },
          },
          { type: 'text', text: 'Here is my answer.' },
        ],
        stopReason: 'end_turn',
      }

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('thinking')
      expect((result.content[0] as any).thinking).toBe('Let me analyze...')
      expect((result.content[0] as any).signature).toBe('sig123')
    })

    it('should handle stop_reason mappings', () => {
      const testCases: Array<{
        unifiedReason: UnifiedResponse['stopReason']
        expectedReason: AnthropicResponse['stop_reason']
      }> = [
        { unifiedReason: 'end_turn', expectedReason: 'end_turn' },
        { unifiedReason: 'max_tokens', expectedReason: 'max_tokens' },
        { unifiedReason: 'tool_use', expectedReason: 'tool_use' },
        { unifiedReason: 'stop_sequence', expectedReason: 'stop_sequence' },
        { unifiedReason: null, expectedReason: null },
      ]

      for (const { unifiedReason, expectedReason } of testCases) {
        const unified = createUnifiedResponse({
          stopReason: unifiedReason,
        })

        const result = transformResponse(unified) as AnthropicResponse
        expect(result.stop_reason).toBe(expectedReason)
      }
    })

    it('should set stop_sequence to null', () => {
      const unified = createUnifiedResponse()

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.stop_sequence).toBeNull()
    })

    it('should use model from unified response', () => {
      const unified = createUnifiedResponse({
        model: 'claude-opus-4-20250514',
      })

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.model).toBe('claude-opus-4-20250514')
    })

    it('should provide default usage if not present', () => {
      const unified: UnifiedResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello' }],
        stopReason: 'end_turn',
      }

      const result = transformResponse(unified) as AnthropicResponse

      expect(result.usage).toBeDefined()
      expect(result.usage.input_tokens).toBe(0)
      expect(result.usage.output_tokens).toBe(0)
    })
  })

  describe('Round-trip transformations', () => {
    it('should maintain text content through parseResponse → transformResponse', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 15 },
      }

      const unified = parseResponse(anthropic)
      const roundTripped = transformResponse(unified) as AnthropicResponse

      expect(roundTripped.id).toBe(anthropic.id)
      expect(roundTripped.content).toHaveLength(1)
      expect((roundTripped.content[0] as any).text).toBe('Hello! How can I help?')
      expect(roundTripped.stop_reason).toBe('end_turn')
    })

    it('should maintain tool_use through parseResponse → transformResponse', () => {
      const anthropic: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'test_tool',
            input: { key: 'value' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }

      const unified = parseResponse(anthropic)
      const roundTripped = transformResponse(unified) as AnthropicResponse

      expect(roundTripped.content).toHaveLength(1)
      expect(roundTripped.content[0].type).toBe('tool_use')
      expect((roundTripped.content[0] as any).id).toBe('toolu_123')
      expect((roundTripped.content[0] as any).name).toBe('test_tool')
    })
  })
})
