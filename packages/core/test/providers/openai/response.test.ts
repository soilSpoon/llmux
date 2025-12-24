import { describe, expect, it } from 'bun:test'
import { parseResponse, transformResponse } from '../../../src/providers/openai/response'
import type { OpenAIResponse } from '../../../src/providers/openai/types'
import type { UnifiedResponse } from '../../../src/types/unified'
import { createUnifiedResponse } from '../_utils/fixtures'

describe('OpenAI Response Transform', () => {
  describe('parseResponse (OpenAIResponse → UnifiedResponse)', () => {
    it('parses a simple text response', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }

      const result = parseResponse(openaiResponse)

      expect(result.id).toBe('chatcmpl-123')
      expect(result.model).toBe('gpt-4')
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello! How can I help you?',
      })
      expect(result.stopReason).toBe('end_turn')
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })
    })

    it('parses finish_reason: length as max_tokens', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Truncated...' },
            finish_reason: 'length',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.stopReason).toBe('max_tokens')
    })

    it('parses finish_reason: tool_calls as tool_use', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.stopReason).toBe('tool_use')
    })

    it('parses finish_reason: content_filter', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null },
            finish_reason: 'content_filter',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.stopReason).toBe('content_filter')
    })

    it('parses tool calls', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: 'tool_call',
        toolCall: {
          id: 'call_abc',
          name: 'get_weather',
          arguments: { location: 'NYC' },
        },
      })
    })

    it('parses multiple tool calls', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location":"LA"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('tool_call')
      expect(result.content[0].toolCall?.id).toBe('call_1')
      expect(result.content[1].toolCall?.id).toBe('call_2')
    })

    it('parses response with text and tool calls', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Let me check the weather for you.',
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.content).toHaveLength(2)
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Let me check the weather for you.',
      })
      expect(result.content[1].type).toBe('tool_call')
    })

    it('parses reasoning_content as thinking', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'o1',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'Let me think step by step...',
            },
            finish_reason: 'stop',
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.thinking).toHaveLength(1)
      expect(result.thinking![0]).toEqual({
        text: 'Let me think step by step...',
      })
    })

    it('parses usage with token details', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: {
            cached_tokens: 20,
          },
          completion_tokens_details: {
            reasoning_tokens: 10,
          },
        },
      }

      const result = parseResponse(openaiResponse)

      expect(result.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedTokens: 20,
        thinkingTokens: 10,
      })
    })

    it('handles null finish_reason', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello' },
            finish_reason: null,
          },
        ],
      }

      const result = parseResponse(openaiResponse)

      expect(result.stopReason).toBeNull()
    })

    it('handles empty choices gracefully', () => {
      const openaiResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1694268190,
        model: 'gpt-4',
        choices: [],
      }

      const result = parseResponse(openaiResponse)

      expect(result.content).toEqual([])
      expect(result.stopReason).toBeNull()
    })
  })

  describe('transformResponse (UnifiedResponse → OpenAIResponse)', () => {
    it('transforms a simple text response', () => {
      const unified = createUnifiedResponse({
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end_turn',
        model: 'gpt-4',
      })

      const result = transformResponse(unified)

      expect(result.id).toBe('resp-123')
      expect(result.object).toBe('chat.completion')
      expect(result.model).toBe('gpt-4')
      expect(result.choices).toHaveLength(1)
      expect(result.choices[0].message).toEqual({
        role: 'assistant',
        content: 'Hello!',
      })
      expect(result.choices[0].finish_reason).toBe('stop')
    })

    it('transforms stopReason: max_tokens to length', () => {
      const unified = createUnifiedResponse({
        stopReason: 'max_tokens',
      })

      const result = transformResponse(unified)

      expect(result.choices[0].finish_reason).toBe('length')
    })

    it('transforms stopReason: tool_use to tool_calls', () => {
      const unified = createUnifiedResponse({
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'test', arguments: {} },
          },
        ],
      })

      const result = transformResponse(unified)

      expect(result.choices[0].finish_reason).toBe('tool_calls')
    })

    it('transforms tool calls', () => {
      const unified = createUnifiedResponse({
        content: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_abc',
              name: 'get_weather',
              arguments: { location: 'NYC' },
            },
          },
        ],
        stopReason: 'tool_use',
      })

      const result = transformResponse(unified)

      expect(result.choices[0].message.content).toBeNull()
      expect(result.choices[0].message.tool_calls).toHaveLength(1)
      expect(result.choices[0].message.tool_calls![0]).toEqual({
        id: 'call_abc',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"NYC"}',
        },
      })
    })

    it('transforms text and tool calls together', () => {
      const unified = createUnifiedResponse({
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'test', arguments: {} },
          },
        ],
        stopReason: 'tool_use',
      })

      const result = transformResponse(unified)

      expect(result.choices[0].message.content).toBe('Let me check.')
      expect(result.choices[0].message.tool_calls).toHaveLength(1)
    })

    it('transforms thinking to reasoning_content', () => {
      const unified = createUnifiedResponse({
        content: [{ type: 'text', text: 'The answer is 42.' }],
        thinking: [{ text: 'Let me think step by step...' }],
        stopReason: 'end_turn',
      })

      const result = transformResponse(unified)

      expect(result.choices[0].message.reasoning_content).toBe('Let me think step by step...')
    })

    it('transforms usage', () => {
      const unified = createUnifiedResponse({
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cachedTokens: 20,
          thinkingTokens: 10,
        },
      })

      const result = transformResponse(unified)

      expect(result.usage).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 20,
        },
        completion_tokens_details: {
          reasoning_tokens: 10,
        },
      })
    })

    it('generates created timestamp', () => {
      const unified = createUnifiedResponse()

      const result = transformResponse(unified)

      expect(result.created).toBeGreaterThan(0)
      expect(typeof result.created).toBe('number')
    })

    it('handles null stopReason', () => {
      const unified = createUnifiedResponse({
        stopReason: null,
      })

      const result = transformResponse(unified)

      expect(result.choices[0].finish_reason).toBeNull()
    })

    it('handles content_filter stopReason', () => {
      const unified = createUnifiedResponse({
        stopReason: 'content_filter',
      })

      const result = transformResponse(unified)

      expect(result.choices[0].finish_reason).toBe('content_filter')
    })

    it('concatenates multiple thinking blocks', () => {
      const unified = createUnifiedResponse({
        thinking: [
          { text: 'First thought.' },
          { text: 'Second thought.' },
        ],
      })

      const result = transformResponse(unified)

      expect(result.choices[0].message.reasoning_content).toBe('First thought.\n\nSecond thought.')
    })
  })
})
