import { describe, expect, it } from 'bun:test'
import {
  parseStreamChunk,
  transformStreamChunk,
} from '../../../src/providers/anthropic/streaming'
import type { StreamChunk } from '../../../src/types/unified'
import type { AnthropicStreamEvent } from '../../../src/providers/anthropic/types'

describe('Anthropic Streaming Transformations', () => {
  describe('parseStreamChunk', () => {
    it('should parse message_start event', () => {
      const sseData = `event: message_start
data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('usage')
      expect(result?.usage?.inputTokens).toBe(10)
    })

    it('should parse text content_block_start event', () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`

      const result = parseStreamChunk(sseData)

      // content_block_start for text typically doesn't produce a chunk
      // It just initializes the block
      expect(result).toBeNull()
    })

    it('should parse text_delta event', () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('content')
      expect(result?.delta?.text).toBe('Hello')
    })

    it('should parse thinking content_block_start event', () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`

      const result = parseStreamChunk(sseData)

      // content_block_start for thinking may or may not produce a chunk
      expect(result === null || result?.type === 'thinking').toBe(true)
    })

    it('should parse thinking_delta event', () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('thinking')
      expect(result?.delta?.thinking?.text).toBe('Let me think...')
    })

    it('should parse signature_delta event', () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM"}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('thinking')
      expect(result?.delta?.thinking?.signature).toBe('EqQBCgIYAhIM')
    })

    it('should parse tool_use content_block_start event', () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather","input":{}}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('tool_call')
      expect(result?.delta?.toolCall?.id).toBe('toolu_123')
      expect(result?.delta?.toolCall?.name).toBe('get_weather')
    })

    it('should parse input_json_delta event', () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"NYC"}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('tool_call')
      // partial_json is accumulated, we just pass it through
    })

    it('should parse content_block_stop event', () => {
      const sseData = `event: content_block_stop
data: {"type":"content_block_stop","index":0}`

      const result = parseStreamChunk(sseData)

      // content_block_stop typically doesn't produce a unified chunk
      expect(result).toBeNull()
    })

    it('should parse message_delta event with stop_reason', () => {
      const sseData = `event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.stopReason).toBe('end_turn')
      expect(result?.usage?.outputTokens).toBe(50)
    })

    it('should parse message_stop event', () => {
      const sseData = `event: message_stop
data: {"type":"message_stop"}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('done')
    })

    it('should parse ping event', () => {
      const sseData = `event: ping
data: {"type":"ping"}`

      const result = parseStreamChunk(sseData)

      // Ping events are typically ignored
      expect(result).toBeNull()
    })

    it('should parse error event', () => {
      const sseData = `event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('error')
      expect(result?.error).toContain('Overloaded')
    })

    it('should handle malformed SSE data gracefully', () => {
      const sseData = 'not valid sse'

      const result = parseStreamChunk(sseData)

      expect(result).toBeNull()
    })

    it('should handle empty data', () => {
      const sseData = ''

      const result = parseStreamChunk(sseData)

      expect(result).toBeNull()
    })

    it('should handle data-only format (without event line)', () => {
      const sseData = `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}`

      const result = parseStreamChunk(sseData)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('content')
      expect(result?.delta?.text).toBe('Hi')
    })

    it('should handle tool_use stop_reason', () => {
      const sseData = `event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":30}}`

      const result = parseStreamChunk(sseData)

      expect(result?.stopReason).toBe('tool_use')
    })

    it('should handle max_tokens stop_reason', () => {
      const sseData = `event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"output_tokens":4096}}`

      const result = parseStreamChunk(sseData)

      expect(result?.stopReason).toBe('max_tokens')
    })
  })

  describe('transformStreamChunk', () => {
    it('should transform content chunk to text_delta SSE', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { text: 'Hello, world!' },
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('event: content_block_delta')
      expect(result).toContain('text_delta')
      expect(result).toContain('Hello, world!')
    })

    it('should transform thinking chunk to thinking_delta SSE', () => {
      const chunk: StreamChunk = {
        type: 'thinking',
        delta: {
          thinking: {
            text: 'Let me analyze...',
          },
        },
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('event: content_block_delta')
      expect(result).toContain('thinking_delta')
      expect(result).toContain('Let me analyze...')
    })

    it('should transform thinking chunk with signature to signature_delta SSE', () => {
      const chunk: StreamChunk = {
        type: 'thinking',
        delta: {
          thinking: {
            text: '',
            signature: 'EqQBCgIYAhIM',
          },
        },
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('signature_delta')
      expect(result).toContain('EqQBCgIYAhIM')
    })

    it('should transform tool_call chunk to content_block_start SSE', () => {
      const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          toolCall: {
            id: 'toolu_123',
            name: 'get_weather',
            arguments: {},
          },
        },
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('tool_use')
      expect(result).toContain('toolu_123')
      expect(result).toContain('get_weather')
    })

    it('should transform done chunk to message_stop SSE', () => {
      const chunk: StreamChunk = {
        type: 'done',
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('event: message_stop')
      expect(result).toContain('message_stop')
    })

    it('should transform error chunk to error SSE', () => {
      const chunk: StreamChunk = {
        type: 'error',
        error: 'Something went wrong',
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('event: error')
      expect(result).toContain('Something went wrong')
    })

    it('should transform usage chunk to message_delta SSE', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
        stopReason: 'end_turn',
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('event: message_delta')
      expect(result).toContain('end_turn')
      expect(result).toContain('output_tokens')
    })

    it('should handle chunk with stop_reason', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { text: 'Final text' },
        stopReason: 'end_turn',
      }

      const result = transformStreamChunk(chunk)

      expect(result).toContain('text_delta')
    })
  })

  describe('Stream parsing integration', () => {
    it('should handle a complete streaming conversation', () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", world!"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ]

      const chunks: StreamChunk[] = []
      for (const sseData of sseChunks) {
        const chunk = parseStreamChunk(sseData)
        if (chunk) {
          chunks.push(chunk)
        }
      }

      // Should have: usage (message_start), 2x content (text deltas), usage (message_delta), done
      expect(chunks.length).toBeGreaterThanOrEqual(4)

      // Check we got text content
      const textChunks = chunks.filter((c) => c.type === 'content')
      expect(textChunks.length).toBe(2)
      expect(textChunks[0].delta?.text).toBe('Hello')
      expect(textChunks[1].delta?.text).toBe(', world!')

      // Check we got done
      const doneChunk = chunks.find((c) => c.type === 'done')
      expect(doneChunk).toBeDefined()
    })

    it('should handle thinking stream', () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgI"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my answer."}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":1}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ]

      const chunks: StreamChunk[] = []
      for (const sseData of sseChunks) {
        const chunk = parseStreamChunk(sseData)
        if (chunk) {
          chunks.push(chunk)
        }
      }

      // Should have thinking chunks
      const thinkingChunks = chunks.filter((c) => c.type === 'thinking')
      expect(thinkingChunks.length).toBeGreaterThanOrEqual(1)

      // Should have text content
      const textChunks = chunks.filter((c) => c.type === 'content')
      expect(textChunks.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle tool use stream', () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather","input":{}}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"loc"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ation\\": \\"NYC\\"}"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":30}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ]

      const chunks: StreamChunk[] = []
      for (const sseData of sseChunks) {
        const chunk = parseStreamChunk(sseData)
        if (chunk) {
          chunks.push(chunk)
        }
      }

      // Should have tool_call chunks
      const toolChunks = chunks.filter((c) => c.type === 'tool_call')
      expect(toolChunks.length).toBeGreaterThanOrEqual(1)

      // First tool chunk should have id and name
      expect(toolChunks[0].delta?.toolCall?.id).toBe('toolu_123')
      expect(toolChunks[0].delta?.toolCall?.name).toBe('get_weather')

      // Check stop reason
      const usageChunk = chunks.find((c) => c.stopReason === 'tool_use')
      expect(usageChunk).toBeDefined()
    })
  })
})
