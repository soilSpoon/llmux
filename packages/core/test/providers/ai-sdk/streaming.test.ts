import { describe, expect, it } from 'bun:test'
import { parseStreamPart, transformStreamPart } from '../../../src/providers/ai-sdk/streaming'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { StreamChunk } from '../../../src/types/unified'

describe('AI SDK Streaming Transformations', () => {
  describe('parseStreamPart', () => {
    it('parses text-delta', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'text-delta',
        id: 'text-1',
        delta: 'Hello',
      }

      const result = parseStreamPart(part)

      expect(result?.type).toBe('content')
      expect(result?.delta?.text).toBe('Hello')
    })

    it('ignores text-start and text-end', () => {
      expect(parseStreamPart({ type: 'text-start', id: '1' })).toBeNull()
      expect(parseStreamPart({ type: 'text-end', id: '1' })).toBeNull()
    })

    it('parses reasoning-delta', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'reasoning-delta',
        id: 'reason-1',
        delta: 'Let me think...',
      }

      const result = parseStreamPart(part)

      expect(result?.type).toBe('thinking')
      expect(result?.delta?.thinking?.text).toBe('Let me think...')
    })

    it('ignores reasoning-start and reasoning-end', () => {
      expect(parseStreamPart({ type: 'reasoning-start', id: '1' })).toBeNull()
      expect(parseStreamPart({ type: 'reasoning-end', id: '1' })).toBeNull()
    })

    it('parses tool-input-start', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'tool-input-start',
        id: 'call_123',
        toolName: 'get_weather',
      }

      const result = parseStreamPart(part)

      expect(result?.type).toBe('tool_call')
      expect(result?.delta?.toolCall?.id).toBe('call_123')
      expect(result?.delta?.toolCall?.name).toBe('get_weather')
    })

    it('parses tool-input-delta', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'tool-input-delta',
        id: 'call_123',
        delta: '{"loc',
      }

      const result = parseStreamPart(part)

      expect(result?.type).toBe('tool_call')
      expect(result?.delta?.toolCall?.id).toBe('call_123')
    })

    it('parses complete tool-call', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'tool-call',
        toolCallId: 'call_abc',
        toolName: 'get_weather',
        input: '{"location":"NYC"}',
      }

      const result = parseStreamPart(part)

      expect(result?.type).toBe('tool_call')
      expect(result?.delta?.toolCall?.id).toBe('call_abc')
      expect(result?.delta?.toolCall?.name).toBe('get_weather')
      expect(result?.delta?.toolCall?.arguments).toEqual({ location: 'NYC' })
    })

    it('parses finish event', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
      }

      const result = parseStreamPart(part)

      expect(result?.type).toBe('done')
      expect(result?.stopReason).toBe('end_turn')
      expect(result?.usage?.inputTokens).toBe(10)
      expect(result?.usage?.outputTokens).toBe(5)
    })

    it('parses finish with tool-calls reason', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: undefined, reasoning: undefined },
        },
      }

      const result = parseStreamPart(part)

      expect(result?.stopReason).toBe('tool_use')
    })

    it('ignores stream-start', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'stream-start',
        warnings: [],
      }

      expect(parseStreamPart(part)).toBeNull()
    })

    it('parses usage with cached tokens', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100, noCache: 20, cacheRead: 80, cacheWrite: undefined },
          outputTokens: { total: 50, text: 30, reasoning: 20 },
        },
      }

      const result = parseStreamPart(part)

      expect(result?.usage?.inputTokens).toBe(100)
      expect(result?.usage?.cachedTokens).toBe(80)
      expect(result?.usage?.thinkingTokens).toBe(20)
    })
  })

  describe('transformStreamPart', () => {
    it('transforms content chunk to text-delta', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'Hello' },
      }

      const result = transformStreamPart(chunk)

      expect(result?.type).toBe('text-delta')
      expect((result as { delta: string }).delta).toBe('Hello')
    })

    it('transforms thinking chunk to reasoning-delta', () => {
      const chunk: StreamChunk = {
        type: 'thinking',
        delta: { type: 'thinking', thinking: { text: 'Thinking...' } },
      }

      const result = transformStreamPart(chunk)

      expect(result?.type).toBe('reasoning-delta')
      expect((result as { delta: string }).delta).toBe('Thinking...')
    })

    it('transforms complete tool_call to tool-call', () => {
      const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: 'call_123',
            name: 'get_weather',
            arguments: { location: 'NYC' },
          },
        },
      }

      const result = transformStreamPart(chunk)

      expect(result?.type).toBe('tool-call')
      const toolCall = result as { toolCallId: string; toolName: string; input: string }
      expect(toolCall.toolCallId).toBe('call_123')
      expect(toolCall.toolName).toBe('get_weather')
      expect(toolCall.input).toBe('{"location":"NYC"}')
    })

    it('transforms done chunk to finish', () => {
      const chunk: StreamChunk = {
        type: 'done',
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
      }

      const result = transformStreamPart(chunk)

      expect(result?.type).toBe('finish')
      const finish = result as { finishReason: { unified: string }; usage: { inputTokens: { total: number } } }
      expect(finish.finishReason.unified).toBe('stop')
      expect(finish.usage.inputTokens.total).toBe(10)
    })

    it('transforms error chunk to finish with error', () => {
      const chunk: StreamChunk = {
        type: 'error',
        error: 'Something went wrong',
      }

      const result = transformStreamPart(chunk)

      expect(result?.type).toBe('finish')
      const finish = result as { finishReason: { unified: string; raw: string } }
      expect(finish.finishReason.unified).toBe('error')
      expect(finish.finishReason.raw).toBe('Something went wrong')
    })

    it('transforms usage chunk to finish', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      }

      const result = transformStreamPart(chunk)

      expect(result?.type).toBe('finish')
    })

    it('returns null for content chunk without text', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: { type: 'text' },
      }

      const result = transformStreamPart(chunk)

      expect(result).toBeNull()
    })
  })

  describe('round-trip', () => {
    it('preserves text-delta through parse -> transform', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'text-delta',
        id: 'text-1',
        delta: 'Hello world',
      }

      const unified = parseStreamPart(part)
      expect(unified).not.toBeNull()
      
      const result = transformStreamPart(unified!)

      expect(result?.type).toBe('text-delta')
      expect((result as { delta: string }).delta).toBe('Hello world')
    })

    it('preserves finish through parse -> transform', () => {
      const part: LanguageModelV3StreamPart = {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
      }

      const unified = parseStreamPart(part)
      expect(unified).not.toBeNull()
      
      const result = transformStreamPart(unified!)

      expect(result?.type).toBe('finish')
      const finish = result as { finishReason: { unified: string } }
      expect(finish.finishReason.unified).toBe('stop')
    })
  })
})
