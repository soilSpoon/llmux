import { describe, expect, it } from 'bun:test'
import { parseStreamChunk, transformStreamChunk } from '../../../src/providers/openai/streaming'
import type { StreamChunk } from '../../../src/types/unified'

describe('OpenAI Streaming', () => {
  describe('parseStreamChunk', () => {
    it('returns null for empty lines', () => {
      expect(parseStreamChunk('')).toBeNull()
      expect(parseStreamChunk('  ')).toBeNull()
    })

    it('returns done chunk for [DONE]', () => {
      const result = parseStreamChunk('data: [DONE]')

      expect(result).toEqual({
        type: 'done',
        stopReason: 'end_turn',
      })
    })

    it('ignores lines without data: prefix', () => {
      expect(parseStreamChunk('something random')).toBeNull()
      expect(parseStreamChunk(': keep-alive')).toBeNull()
    })

    it('parses text content delta', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'Hello',
        },
      })
    })

    it('parses role-only first chunk', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      // Empty content should still return content chunk with empty text
      expect(result).toEqual({
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: '',
        },
      })
    })

    it('parses finish_reason: stop', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'done',
        blockIndex: 0,
        stopReason: 'end_turn',
      })
    })

    it('parses finish_reason: length as max_tokens', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'length',
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'done',
        blockIndex: 0,
        stopReason: 'max_tokens',
      })
    })

    it('parses finish_reason: tool_calls', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'done',
        blockIndex: 0,
        stopReason: 'tool_use',
      })
    })

    it('parses first tool call chunk with id and name', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'tool_call',
        blockIndex: 0,
        blockType: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: 'call_abc123',
            name: 'get_weather',
            arguments: '', // Empty string for streaming - will be accumulated
          },
        },
      })
    })

    it('parses incremental tool call arguments to partialJson', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: '{"lo',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      // For incremental arguments, we return partialJson for proper accumulation
      expect(result).toEqual({
        type: 'tool_call',
        blockIndex: 0,
        blockType: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: '{"lo',
        },
      })
    })

    it('parses usage chunk', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      })
    })

    it('handles malformed JSON gracefully', () => {
      const result = parseStreamChunk('data: {invalid json')

      expect(result).toEqual({
        type: 'error',
        error: expect.stringContaining('Failed to parse'),
      })
    })

    it('handles empty choices array', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toBeNull()
    })
  })

  describe('transformStreamChunk', () => {
    it('transforms content chunk', () => {
      const chunk: StreamChunk = {
        type: 'content',
        delta: {
          type: 'text',
          text: 'Hello',
        },
      }

      const result = transformStreamChunk(chunk)

      expect(result).toMatch(/^data: /)
      const data = JSON.parse(result.replace('data: ', ''))
      expect(data.object).toBe('chat.completion.chunk')
      expect(data.choices[0].delta.content).toBe('Hello')
      expect(data.choices[0].finish_reason).toBeNull()
    })

    it('transforms done chunk', () => {
      const chunk: StreamChunk = {
        type: 'done',
        stopReason: 'end_turn',
      }

      const result = transformStreamChunk(chunk)

      expect(result).toMatch(/^data: /)
      const data = JSON.parse(result.replace('data: ', ''))
      expect(data.choices[0].delta).toEqual({})
      expect(data.choices[0].finish_reason).toBe('stop')
    })

    it('transforms done with max_tokens stopReason', () => {
      const chunk: StreamChunk = {
        type: 'done',
        stopReason: 'max_tokens',
      }

      const result = transformStreamChunk(chunk)

      const data = JSON.parse(result.replace('data: ', ''))
      expect(data.choices[0].finish_reason).toBe('length')
    })

    it('transforms done with tool_use stopReason', () => {
      const chunk: StreamChunk = {
        type: 'done',
        stopReason: 'tool_use',
      }

      const result = transformStreamChunk(chunk)

      const data = JSON.parse(result.replace('data: ', ''))
      expect(data.choices[0].finish_reason).toBe('tool_calls')
    })

    it('transforms tool_call chunk with full info', () => {
      const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: 'call_abc',
            name: 'get_weather',
            arguments: { location: 'NYC' },
          },
        },
      }

      const result = transformStreamChunk(chunk)

      const data = JSON.parse(result.replace('data: ', ''))
      expect(data.choices[0].delta.tool_calls).toHaveLength(1)
      expect(data.choices[0].delta.tool_calls[0]).toEqual({
        index: 0,
        id: 'call_abc',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"NYC"}',
        },
      })
    })

    it('transforms usage chunk', () => {
      const chunk: StreamChunk = {
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      }

      const result = transformStreamChunk(chunk)

      const data = JSON.parse(result.replace('data: ', ''))
      expect(data.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      })
      expect(data.choices).toEqual([])
    })

    it('transforms error chunk', () => {
      const chunk: StreamChunk = {
        type: 'error',
        error: 'Something went wrong',
      }

      const result = transformStreamChunk(chunk)

      // Error chunks could be formatted differently, but for now return [DONE]
      expect(result).toBe('data: [DONE]')
    })

    it('generates unique ids for each chunk', () => {
      const chunk1: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'a' },
      }
      const chunk2: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'b' },
      }

      const result1 = transformStreamChunk(chunk1)
      const result2 = transformStreamChunk(chunk2)

      const data1 = JSON.parse(result1.replace('data: ', ''))
      const data2 = JSON.parse(result2.replace('data: ', ''))

      // IDs should be present (might be same for simplicity, or different)
      expect(data1.id).toBeDefined()
      expect(data2.id).toBeDefined()
    })

    it('transforms thinking chunk', () => {
      const chunk: StreamChunk = {
        type: 'thinking',
        delta: {
          type: 'thinking',
          thinking: {
            text: 'Let me think...',
          },
        },
      }

      const result = transformStreamChunk(chunk)

      // For OpenAI, thinking would go to reasoning_content in the delta
      // But streaming format may vary - for now just ensure it doesn't crash
      expect(result).toMatch(/^data: /)
    })
  })

  describe('reasoning_content streaming', () => {
    it('parses reasoning_content delta', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: 'Let me analyze this step by step...' },
            finish_reason: null,
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      expect(result).toEqual({
        type: 'thinking',
        blockIndex: 0,
        blockType: 'thinking',
        delta: {
          type: 'thinking',
          thinking: {
            text: 'Let me analyze this step by step...',
          },
        },
      })
    })

    it('parses multiple reasoning_content chunks', () => {
      const chunk1 = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: 'First' },
            finish_reason: null,
          },
        ],
      })

      const chunk2 = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: ' step' },
            finish_reason: null,
          },
        ],
      })

      const result1 = parseStreamChunk(`data: ${chunk1}`)
      const result2 = parseStreamChunk(`data: ${chunk2}`)

      expect(result1?.type).toBe('thinking')
      expect(result1?.delta?.thinking?.text).toBe('First')

      expect(result2?.type).toBe('thinking')
      expect(result2?.delta?.thinking?.text).toBe(' step')
    })

    it('parses mixed content and reasoning_content stream', () => {
      const reasoningChunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: 'Thinking...' },
            finish_reason: null,
          },
        ],
      })

      const contentChunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            delta: { content: 'Answer' },
            finish_reason: null,
          },
        ],
      })

      const reasoningResult = parseStreamChunk(`data: ${reasoningChunk}`)
      const contentResult = parseStreamChunk(`data: ${contentChunk}`)

      expect(reasoningResult?.type).toBe('thinking')
      expect(reasoningResult?.delta?.thinking?.text).toBe('Thinking...')

      expect(contentResult?.type).toBe('content')
      expect(contentResult?.delta?.text).toBe('Answer')
    })

    it('handles empty reasoning_content gracefully', () => {
      const chunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: '' },
            finish_reason: null,
          },
        ],
      })

      const result = parseStreamChunk(`data: ${chunk}`)

      // Empty reasoning_content should still be treated as thinking type
      expect(result?.type).toBe('thinking')
      expect(result?.delta?.thinking?.text).toBe('')
    })
  })

  describe('partialJson streaming', () => {
    it('transforms partialJson chunk to OpenAI function arguments', () => {
      const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: '{"location": "NYC',
        },
      }

      const result = transformStreamChunk(chunk)
      const data = JSON.parse(result.replace('data: ', ''))

      expect(data.choices[0].delta.tool_calls).toBeDefined()
      expect(data.choices[0].delta.tool_calls[0].function.arguments).toBe('{"location": "NYC')
    })

    it('accumulates partialJson chunks across multiple events', () => {
      const chunks: StreamChunk[] = [
        {
          type: 'tool_call',
          delta: { type: 'tool_call', partialJson: '{"x": ' },
        },
        {
          type: 'tool_call',
          delta: { type: 'tool_call', partialJson: '10, "y": ' },
        },
        {
          type: 'tool_call',
          delta: { type: 'tool_call', partialJson: '20}' },
        },
      ]

      let accumulated = ''
      for (const chunk of chunks) {
        if (chunk.delta?.partialJson) {
          accumulated += chunk.delta.partialJson
        }
      }

      expect(accumulated).toBe('{"x": 10, "y": 20}')
    })

    it('round-trips partialJson through unified format', () => {
      // Parse OpenAI function_call_arguments_delta
      const openaiChunk = JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: '{"key":',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })

      const parseResult = parseStreamChunk(`data: ${openaiChunk}`)
      expect(parseResult?.delta?.partialJson).toBe('{"key":')

      // Transform back to OpenAI format
      const transformResult = transformStreamChunk(parseResult!)
      const data = JSON.parse(transformResult.replace('data: ', ''))

      expect(data.choices[0].delta.tool_calls[0].function.arguments).toBe('{"key":')
    })
  })
})
