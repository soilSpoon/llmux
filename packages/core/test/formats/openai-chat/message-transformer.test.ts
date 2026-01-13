import { describe, expect, it } from 'bun:test'
import { transformMessage } from '../../../src/formats/openai-chat/message-transformer'
import type { UnifiedMessage } from '../../../src/types/unified'

describe('OpenAI Chat Message Transformer', () => {
  describe('transformMessage', () => {
    it('transforms user message with text', () => {
      const msg: UnifiedMessage = {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      }
      const result = transformMessage(msg)
      expect(result).toEqual({
        role: 'user',
        content: 'Hello',
      })
    })

    it('transforms user message with image', () => {
      const msg: UnifiedMessage = {
        role: 'user',
        parts: [
          { type: 'text', text: 'Look at this' },
          {
            type: 'image',
            image: { mimeType: 'image/png', url: 'https://example.com/img.png' },
          },
        ],
      }
      const result = transformMessage(msg)
      expect(Array.isArray(result.content)).toBe(true)
      expect((result.content as any)[0]).toEqual({ type: 'text', text: 'Look at this' })
      expect((result.content as any)[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/img.png' },
      })
    })

    it('transforms user message with base64 image', () => {
      const msg: UnifiedMessage = {
        role: 'user',
        parts: [
          {
            type: 'image',
            image: { mimeType: 'image/jpeg', data: 'BASE64' },
          },
        ],
      }
      const result = transformMessage(msg)
      expect((result.content as any)[0].image_url.url).toBe('data:image/jpeg;base64,BASE64')
    })

    it('transforms assistant message with text', () => {
      const msg: UnifiedMessage = {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Response' }],
      }
      const result = transformMessage(msg)
      expect(result).toEqual({
        role: 'assistant',
        content: 'Response',
      })
    })

    it('transforms assistant message with tool calls', () => {
      const msg: UnifiedMessage = {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'test_tool',
              arguments: { arg: 'val' },
            },
          },
        ],
      }
      const result = transformMessage(msg) as any
      expect(result.tool_calls).toHaveLength(1)
      expect(result.tool_calls[0]).toEqual({
        id: 'call_1',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: '{"arg":"val"}',
        },
      })
    })

    it('transforms assistant message with both text and tool calls', () => {
      const msg: UnifiedMessage = {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Calling tool' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'test',
              arguments: {},
            },
          },
        ],
      }
      const result = transformMessage(msg) as any
      expect(result.content).toBe('Calling tool')
      expect(result.tool_calls).toHaveLength(1)
    })

    it('transforms tool message', () => {
      const msg: UnifiedMessage = {
        role: 'tool',
        parts: [
          {
            type: 'tool_result',
            toolResult: {
              toolCallId: 'call_1',
              content: 'Result',
            },
          },
        ],
      }
      const result = transformMessage(msg) as any
      expect(result).toEqual({
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'Result',
      })
    })

    it('handles object tool results', () => {
      const msg: UnifiedMessage = {
        role: 'tool',
        parts: [
          {
            type: 'tool_result',
            toolResult: {
              toolCallId: 'call_1',
              // content must be string or ContentPart[], objects should be stringified
              content: JSON.stringify({ status: 'ok' }),
            },
          },
        ],
      }
      const result = transformMessage(msg) as any
      expect(result.content).toBe('{"status":"ok"}')
    })

    it('converts thinking parts to text in OpenAI format', () => {
      const msg: UnifiedMessage = {
        role: 'assistant',
        parts: [
          {
            type: 'thinking',
            thinking: { text: 'Thought process' },
          },
        ],
      }
      const result = transformMessage(msg)
      expect(result.content).toBe('Thought process')
    })

    it('throws on unknown role', () => {
      const msg = {
        role: 'unknown',
        parts: [],
      } as unknown as UnifiedMessage
      expect(() => transformMessage(msg)).toThrow('Unknown message role')
    })

    it('throws on missing tool result', () => {
      const msg: UnifiedMessage = {
        role: 'tool',
        parts: [],
      }
      expect(() => transformMessage(msg)).toThrow('Tool message must have a tool_result part')
    })
  })
})
