import { describe, expect, it } from 'bun:test'
import {
  extractTextContent,
  parseMessage,
  reconstructFlattenedToolCalls,
} from '../../../src/formats/openai-chat/message-parser'
import type { OpenAIChatMessage } from '../../../src/formats/openai-chat/types'

describe('OpenAI Chat Message Parser', () => {
  describe('parseMessage', () => {
    it('parses simple user message', () => {
      const msg: OpenAIChatMessage = {
        role: 'user',
        content: 'Hello',
      }
      const result = parseMessage(msg)
      expect(result).toEqual({
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      })
    })

    it('parses user message with content array', () => {
      const msg: OpenAIChatMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/image.png' },
          },
        ],
      }
      const result = parseMessage(msg)
      expect(result?.parts).toHaveLength(2)
      expect(result?.parts[0]).toEqual({ type: 'text', text: 'Hello' })
      expect(result?.parts[1]).toEqual({
        type: 'image',
        image: {
          mimeType: 'image/png',
          url: 'https://example.com/image.png',
        },
      })
    })

    it('parses user message with base64 image', () => {
      const msg: OpenAIChatMessage = {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,BASE64DATA' },
          },
        ],
      }
      const result = parseMessage(msg)
      expect(result?.parts[0]).toEqual({
        type: 'image',
        image: {
          mimeType: 'image/jpeg',
          data: 'BASE64DATA',
        },
      })
    })

    it('parses assistant message with text', () => {
      const msg: OpenAIChatMessage = {
        role: 'assistant',
        content: 'Response',
      }
      const result = parseMessage(msg)
      expect(result).toEqual({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Response' }],
      })
    })

    it('parses assistant message with tool calls', () => {
      const msg: OpenAIChatMessage = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{"arg": "value"}',
            },
          },
        ],
      }
      const result = parseMessage(msg)
      expect(result?.parts).toHaveLength(1)
      expect(result?.parts[0]).toEqual({
        type: 'tool_call',
        toolCall: {
          id: 'call_1',
          name: 'test_tool',
          arguments: { arg: 'value' },
        },
      })
    })

    it('parses tool message', () => {
      const msg: OpenAIChatMessage = {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'Result',
      }
      const result = parseMessage(msg)
      expect(result?.parts[0]).toEqual({
        type: 'tool_result',
        toolResult: {
          toolCallId: 'call_1',
          content: 'Result',
        },
      })
    })

    it('throws on system message', () => {
      const msg: OpenAIChatMessage = {
        role: 'system',
        content: 'System prompt',
      }
      expect(() => parseMessage(msg)).toThrow('System/Developer messages should be handled separately')
    })

    it('ignores unknown roles', () => {
      const msg = {
        role: 'unknown',
        content: 'test',
      } as unknown as OpenAIChatMessage
      expect(parseMessage(msg)).toBeNull()
    })
  })

  describe('reconstructFlattenedToolCalls', () => {
    it('reconstructs flattened tool calls into assistant message', () => {
      const messages = [
        { role: 'user', content: 'Use tool' },
        {
          type: 'function',
          name: 'tool1',
          call_id: 'call_1',
          arguments: '{}',
        },
        {
          type: 'function',
          name: 'tool2',
          call_id: 'call_2',
          arguments: '{}',
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'result1' },
      ]

      const result = reconstructFlattenedToolCalls(messages)

      expect(result).toHaveLength(3) // user, assistant(with 2 calls), tool
      expect(result[0]?.role).toBe('user')
      expect(result[1]?.role).toBe('assistant')

      const assistantMsg = result[1] as any
      expect(assistantMsg.tool_calls).toHaveLength(2)
      expect(result[2]?.role).toBe('tool')
    })

    it('handles mixed content correctly', () => {
      const messages = [
        { role: 'user', content: 'test' },
        null,
        undefined,
        { role: 'assistant', content: 'response' },
      ]

      const result = reconstructFlattenedToolCalls(messages)

      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('user')
      expect(result[1]?.role).toBe('assistant')
    })
  })

  describe('extractTextContent', () => {
    it('extracts string content', () => {
      expect(extractTextContent('Hello')).toBe('Hello')
    })

    it('extracts text from content parts', () => {
      const parts = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: '...' } },
        { type: 'text', text: 'World' },
      ] as any
      expect(extractTextContent(parts)).toBe('Hello\nWorld')
    })
  })
})
