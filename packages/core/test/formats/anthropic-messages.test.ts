import { describe, expect, it } from 'bun:test'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'
import type { FormatContext } from '../../src/formats/base'
import type { StreamChunk } from '../../src/types/unified'
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTool,
  createUnifiedToolCall,
} from '../providers/_utils/fixtures'

describe('AnthropicMessagesFormat', () => {
  const ctx: FormatContext = {
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
  }

  describe('id', () => {
    it('should have id "anthropic-messages"', () => {
      expect(AnthropicMessagesFormat.id).toBe('anthropic-messages')
    })
  })

  describe('isSupportedWireRequest', () => {
    it('should return true for valid Anthropic Messages request', () => {
      const req = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      }
      expect(AnthropicMessagesFormat.isSupportedWireRequest(req)).toBe(true)
    })

    it('should return false for request without required fields', () => {
      const req = {
        messages: [{ role: 'user', content: 'Hello' }],
      }
      expect(AnthropicMessagesFormat.isSupportedWireRequest(req)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(AnthropicMessagesFormat.isSupportedWireRequest(null)).toBe(false)
      expect(AnthropicMessagesFormat.isSupportedWireRequest(undefined)).toBe(false)
      expect(AnthropicMessagesFormat.isSupportedWireRequest('string')).toBe(false)
    })
  })

  describe('isSupportedWireResponse', () => {
    it('should return true for valid Anthropic response', () => {
      const res = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }
      expect(AnthropicMessagesFormat.isSupportedWireResponse(res)).toBe(true)
    })

    it('should return false for non-object values', () => {
      expect(AnthropicMessagesFormat.isSupportedWireResponse(null)).toBe(false)
      expect(AnthropicMessagesFormat.isSupportedWireResponse(undefined)).toBe(false)
    })
  })

  describe('parseRequest', () => {
    it('should parse a simple messages request', () => {
      const req = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      }

      const result = AnthropicMessagesFormat.parseRequest(req)

      expect(result.messages).toHaveLength(1)
      const msg = result.messages[0]!
      expect(msg.role).toBe('user')
      const part = msg.parts[0]!
      expect(part.type).toBe('text')
      expect(part.text).toBe('Hello')
    })

    it('should parse system prompt', () => {
      const req = {
        model: 'claude-3-opus-20240229',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1024,
      }

      const result = AnthropicMessagesFormat.parseRequest(req)

      expect(result.system).toBe('You are helpful.')
    })

    it('should parse tool use', () => {
      const req = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_123',
                name: 'get_weather',
                input: { location: 'NYC' },
              },
            ],
          },
        ],
        max_tokens: 1024,
      }

      const result = AnthropicMessagesFormat.parseRequest(req)

      const msg = result.messages[0]!
      expect(msg.role).toBe('assistant')
      const part = msg.parts[0]!
      expect(part.type).toBe('tool_call')
      expect(part.toolCall?.name).toBe('get_weather')
    })

    it('should parse generation config', () => {
      const req = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 2048,
        temperature: 0.5,
        top_p: 0.9,
      }

      const result = AnthropicMessagesFormat.parseRequest(req)

      expect(result.config?.maxTokens).toBe(2048)
      expect(result.config?.temperature).toBe(0.5)
      expect(result.config?.topP).toBe(0.9)
    })
  })

  describe('buildWireRequest', () => {
    it('should build a simple messages request', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = AnthropicMessagesFormat.buildWireRequest(unified, ctx) as {
        messages: unknown[]
        max_tokens: number
      }

      // Model is now restored from metadata in transform
      expect(result.messages).toHaveLength(1)
      expect(result.max_tokens).toBe(1000)
    })

    it('should include system prompt', () => {
      const unified = createUnifiedRequest({
        system: 'You are helpful.',
        messages: [createUnifiedMessage('user', 'Hello')],
      })

      const result = AnthropicMessagesFormat.buildWireRequest(unified, ctx) as {
        system: Array<{ type: string; text: string }>
      }

      expect(result.system).toBeDefined()
      expect(result.system[0]!.text).toBe('You are helpful.')
    })

    it('should transform tool calls', () => {
      const unified = createUnifiedRequest({
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool_call',
                toolCall: createUnifiedToolCall('get_weather', { location: 'NYC' }, 'call_123'),
              },
            ],
          },
        ],
      })

      const result = AnthropicMessagesFormat.buildWireRequest(unified, ctx) as {
        messages: Array<{ content: Array<{ type: string; name?: string }> }>
      }

      const content = result.messages[0]!.content
      expect(content[0]!.type).toBe('tool_use')
      expect(content[0]!.name).toBe('get_weather')
    })

    it('should transform tools', () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage('user', 'Hello')],
        tools: [
          createUnifiedTool('get_weather', 'Get weather', {
            type: 'object',
            properties: { location: { type: 'string' } },
          }),
        ],
      })

      const result = AnthropicMessagesFormat.buildWireRequest(unified, ctx) as {
        tools: Array<{ name: string }>
      }

      expect(result.tools).toHaveLength(1)
      expect(result.tools[0]!.name).toBe('get_weather')
    })
  })

  describe('parseResponse', () => {
    it('should parse a simple response', () => {
      const res = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }

      const result = AnthropicMessagesFormat.parseResponse(res)

      expect(result.id).toBe('msg_123')
      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.text).toBe('Hello!')
      expect(result.stopReason).toBe('end_turn')
    })

    it('should parse response with tool use', () => {
      const res = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking weather...' },
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'get_weather',
            input: { location: 'NYC' },
          },
        ],
        model: 'claude-3-opus-20240229',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      }

      const result = AnthropicMessagesFormat.parseResponse(res)

      expect(result.content).toHaveLength(2)
      expect(result.content[0]!.type).toBe('text')
      expect(result.content[1]!.type).toBe('tool_call')
      expect(result.content[1]!.toolCall?.name).toBe('get_weather')
      expect(result.stopReason).toBe('tool_use')
    })
  })

  describe('buildWireResponse', () => {
    it('should build a simple response', () => {
      const unified = createUnifiedResponse({
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        model: 'claude-3-opus-20240229',
      })

      const result = AnthropicMessagesFormat.buildWireResponse(unified, ctx) as {
        id: string
        content: Array<{ type: string; text: string }>
        stop_reason: string
      }

      expect(result.id).toBe('msg_123')
      expect(result.content).toHaveLength(1)
      expect(result.content[0]!.text).toBe('Hello!')
      expect(result.stop_reason).toBe('end_turn')
    })

    it('should build response with tool use', () => {
      const unified = createUnifiedResponse({
        id: 'msg_123',
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_123',
              name: 'get_weather',
              arguments: { location: 'NYC' },
            },
          },
        ],
        stopReason: 'tool_use',
      })

      const result = AnthropicMessagesFormat.buildWireResponse(unified, ctx) as {
        content: Array<{ type: string; name?: string }>
        stop_reason: string
      }

      expect(result.content[0]!.type).toBe('tool_use')
      expect(result.content[0]!.name).toBe('get_weather')
      expect(result.stop_reason).toBe('tool_use')
    })
  })

  describe('parseStreamChunk', () => {
    it('should parse message_start event', () => {
      const chunk =
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","role":"assistant","content":[],"model":"claude-3-opus","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}'

      const result = AnthropicMessagesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      // Note: message_start currently returns usage chunk if it has usage info
      // or null if handled internally by stream parser state
      // The implementation details might vary based on stream parser state
    })

    it('should parse content_block_delta (text)', () => {
      const chunk =
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}'

      const result = AnthropicMessagesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('content')
      expect(streamChunk.delta?.text).toBe('Hello')
    })

    it('should parse content_block_start (tool_use)', () => {
      const chunk =
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_123","name":"get_weather","input":{}}}'

      const result = AnthropicMessagesFormat.parseStreamChunk!(chunk)

      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('tool_call')
      expect(streamChunk.delta?.toolCall?.name).toBe('get_weather')
    })

    it('should parse message_delta (stop_reason)', () => {
      const chunk =
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}'

      const result = AnthropicMessagesFormat.parseStreamChunk!(chunk)

      // Should return usage chunk
      expect(result).not.toBeNull()
      const streamChunk = result as StreamChunk
      expect(streamChunk.type).toBe('usage')
    })
  })

  describe('buildStreamChunk', () => {
    it('should build a content chunk', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'Hello' },
        blockIndex: 0,
      }

      const result = AnthropicMessagesFormat.buildStreamChunk!(chunk, ctx)

      expect(typeof result).toBe('string')
      const resultStr = result as string
      expect(resultStr).toContain('event: content_block_delta')
      expect(resultStr).toContain('"text":"Hello"')
    })

    it('should build a done chunk', () => {
      const chunk: StreamChunk = {
        type: 'done',
        stopReason: 'end_turn',
      }

      const result = AnthropicMessagesFormat.buildStreamChunk!(chunk, ctx)

      expect(result).toBeDefined()
      // Should include message_stop
      const resultStr = Array.isArray(result) ? result.join('\n') : (result as string)
      expect(resultStr).toContain('event: message_stop')
    })
  })
})
