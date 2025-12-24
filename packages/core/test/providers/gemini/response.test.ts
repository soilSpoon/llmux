import { describe, expect, it } from 'bun:test'
import { parseResponse, transformResponse } from '../../../src/providers/gemini/response'
import type { UnifiedResponse } from '../../../src/types/unified'
import type { GeminiResponse } from '../../../src/providers/gemini/types'
import { createUnifiedResponse } from '../_utils/fixtures'

describe('Gemini Response Transformations', () => {
  describe('parseResponse (GeminiResponse → UnifiedResponse)', () => {
    describe('basic responses', () => {
      it('should parse a simple text response', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello! How can I help?' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
          responseId: 'resp_123',
        }

        const result = parseResponse(gemini)

        expect(result.id).toBe('resp_123')
        expect(result.content).toHaveLength(1)
        expect(result.content[0].type).toBe('text')
        expect(result.content[0].text).toBe('Hello! How can I help?')
        expect(result.stopReason).toBe('end_turn')
      })

      it('should generate id if responseId is missing', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.id).toBeDefined()
        expect(result.id.length).toBeGreaterThan(0)
      })
    })

    describe('stop reason mapping', () => {
      it('should map STOP to end_turn', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Done' }] },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('end_turn')
      })

      it('should map MAX_TOKENS to max_tokens', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Cut off...' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('max_tokens')
      })

      it('should map SAFETY to content_filter', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'SAFETY',
            },
          ],
        }

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('content_filter')
      })

      it('should detect tool_use when functionCall is present', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'get_weather', args: { location: 'NYC' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('tool_use')
      })

      it('should handle OTHER as null', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Error' }] },
              finishReason: 'OTHER',
            },
          ],
        }

        const result = parseResponse(gemini)
        expect(result.stopReason).toBeNull()
      })
    })

    describe('usage metadata', () => {
      it('should map usageMetadata to usage', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150,
          },
        }

        const result = parseResponse(gemini)

        expect(result.usage).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        })
      })

      it('should include thinkingTokens when present', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Answer' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 350,
            thoughtsTokenCount: 200,
          },
        }

        const result = parseResponse(gemini)

        expect(result.usage?.thinkingTokens).toBe(200)
      })

      it('should include cachedTokens when present', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150,
            cachedContentTokenCount: 30,
          },
        }

        const result = parseResponse(gemini)

        expect(result.usage?.cachedTokens).toBe(30)
      })
    })

    describe('function calls', () => {
      it('should parse functionCall parts to tool_call content', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'Tokyo', unit: 'celsius' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(1)
        expect(result.content[0].type).toBe('tool_call')
        expect(result.content[0].toolCall?.name).toBe('get_weather')
        expect(result.content[0].toolCall?.arguments).toEqual({
          location: 'Tokyo',
          unit: 'celsius',
        })
      })

      it('should generate tool call id if not present', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'get_weather', args: {} } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.content[0].toolCall?.id).toBeDefined()
        expect(result.content[0].toolCall?.id.length).toBeGreaterThan(0)
      })

      it('should handle multiple function calls', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'get_weather', args: { location: 'NYC' } } },
                  { functionCall: { name: 'get_time', args: { timezone: 'EST' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(2)
        expect(result.content[0].toolCall?.name).toBe('get_weather')
        expect(result.content[1].toolCall?.name).toBe('get_time')
      })

      it('should handle text and function call together', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { text: 'Let me check the weather.' },
                  { functionCall: { name: 'get_weather', args: {} } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(2)
        expect(result.content[0].type).toBe('text')
        expect(result.content[1].type).toBe('tool_call')
      })
    })

    describe('thinking blocks', () => {
      it('should extract thought parts to thinking array', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    thought: true,
                    text: 'Let me think about this carefully...',
                    thoughtSignature: 'sig123',
                  },
                  { text: 'The answer is 42.' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.thinking).toHaveLength(1)
        expect(result.thinking![0].text).toBe('Let me think about this carefully...')
        expect(result.thinking![0].signature).toBe('sig123')
        expect(result.content).toHaveLength(1)
        expect(result.content[0].text).toBe('The answer is 42.')
      })

      it('should handle multiple thinking blocks', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { thought: true, text: 'First thought...', thoughtSignature: 'sig1' },
                  { thought: true, text: 'Second thought...', thoughtSignature: 'sig2' },
                  { text: 'Final answer.' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.thinking).toHaveLength(2)
        expect(result.thinking![0].text).toBe('First thought...')
        expect(result.thinking![1].text).toBe('Second thought...')
      })
    })

    describe('empty/edge cases', () => {
      it('should handle empty parts', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(0)
      })

      it('should handle missing finishReason', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Partial' }] },
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.stopReason).toBeNull()
      })
    })

    describe('edge cases', () => {
      it('should handle undefined candidates', () => {
        const gemini = {
          responseId: 'resp_123',
        } as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.id).toBe('resp_123')
        expect(result.content).toHaveLength(0)
        expect(result.stopReason).toBeNull()
      })

      it('should handle null candidates', () => {
        const gemini = {
          candidates: null,
          responseId: 'resp_123',
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(0)
        expect(result.stopReason).toBeNull()
      })

      it('should handle empty candidates array', () => {
        const gemini: GeminiResponse = {
          candidates: [],
          responseId: 'resp_123',
        }

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(0)
        expect(result.stopReason).toBeNull()
      })

      it('should handle missing content in candidate', () => {
        const gemini = {
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(0)
        expect(result.stopReason).toBe('end_turn')
      })

      it('should handle invalid finishReason values', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'INVALID_REASON',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.stopReason).toBeNull()
      })

      it('should map BLOCKLIST to content_filter', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'BLOCKLIST',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('content_filter')
      })

      it('should map PROHIBITED_CONTENT to content_filter', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'PROHIBITED_CONTENT',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('content_filter')
      })

      it('should map SPII to content_filter', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'SPII',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)
        expect(result.stopReason).toBe('content_filter')
      })

      it('should handle malformed usageMetadata with missing fields', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
          },
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.usage?.inputTokens).toBe(10)
        expect(result.usage?.outputTokens).toBeUndefined()
        expect(result.usage?.totalTokens).toBeUndefined()
      })

      it('should handle empty usageMetadata object', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {},
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.usage).toBeDefined()
      })

      it('should handle empty parts array', () => {
        const gemini: GeminiResponse = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'STOP',
            },
          ],
        }

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(0)
        expect(result.thinking).toBeUndefined()
      })

      it('should handle mixed content types (text + functionCall + inlineData)', () => {
        const gemini = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { text: 'Here is the result:' },
                  { functionCall: { name: 'get_image', args: { query: 'cat' } } },
                  { inlineData: { mimeType: 'image/png', data: 'base64data' } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.content.length).toBeGreaterThanOrEqual(2)
        expect(result.content[0].type).toBe('text')
        expect(result.content[0].text).toBe('Here is the result:')
        expect(result.content[1].type).toBe('tool_call')
        expect(result.content[1].toolCall?.name).toBe('get_image')
      })

      it('should handle inlineData response parsing', () => {
        const gemini = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.stopReason).toBe('end_turn')
      })

      it('should handle candidate with undefined parts', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model' },
              finishReason: 'STOP',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)

        expect(result.content).toHaveLength(0)
      })

      it('should handle RECITATION finishReason as null', () => {
        const gemini = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'RECITATION',
            },
          ],
        } as unknown as GeminiResponse

        const result = parseResponse(gemini)
        expect(result.stopReason).toBeNull()
      })
    })
  })

  describe('transformResponse (UnifiedResponse → GeminiResponse)', () => {
    describe('basic responses', () => {
      it('should transform a simple text response', () => {
        const unified = createUnifiedResponse({
          id: 'resp_123',
          content: [{ type: 'text', text: 'Hello!' }],
          stopReason: 'end_turn',
        })

        const result = transformResponse(unified)

        expect(result.responseId).toBe('resp_123')
        expect(result.candidates).toHaveLength(1)
        expect(result.candidates[0].content.role).toBe('model')
        expect(result.candidates[0].content.parts[0].text).toBe('Hello!')
        expect(result.candidates[0].finishReason).toBe('STOP')
      })
    })

    describe('stop reason mapping', () => {
      it('should map end_turn to STOP', () => {
        const unified = createUnifiedResponse({ stopReason: 'end_turn' })
        const result = transformResponse(unified)
        expect(result.candidates[0].finishReason).toBe('STOP')
      })

      it('should map max_tokens to MAX_TOKENS', () => {
        const unified = createUnifiedResponse({ stopReason: 'max_tokens' })
        const result = transformResponse(unified)
        expect(result.candidates[0].finishReason).toBe('MAX_TOKENS')
      })

      it('should map content_filter to SAFETY', () => {
        const unified = createUnifiedResponse({ stopReason: 'content_filter' })
        const result = transformResponse(unified)
        expect(result.candidates[0].finishReason).toBe('SAFETY')
      })

      it('should map tool_use to STOP', () => {
        const unified = createUnifiedResponse({ stopReason: 'tool_use' })
        const result = transformResponse(unified)
        expect(result.candidates[0].finishReason).toBe('STOP')
      })

      it('should map null to undefined', () => {
        const unified = createUnifiedResponse({ stopReason: null })
        const result = transformResponse(unified)
        expect(result.candidates[0].finishReason).toBeUndefined()
      })
    })

    describe('usage metadata', () => {
      it('should transform usage to usageMetadata', () => {
        const unified = createUnifiedResponse({
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        })

        const result = transformResponse(unified)

        expect(result.usageMetadata).toEqual({
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        })
      })

      it('should include thoughtsTokenCount when thinkingTokens present', () => {
        const unified = createUnifiedResponse({
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 350,
            thinkingTokens: 200,
          },
        })

        const result = transformResponse(unified)

        expect(result.usageMetadata?.thoughtsTokenCount).toBe(200)
      })

      it('should include cachedContentTokenCount when cachedTokens present', () => {
        const unified = createUnifiedResponse({
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cachedTokens: 30,
          },
        })

        const result = transformResponse(unified)

        expect(result.usageMetadata?.cachedContentTokenCount).toBe(30)
      })
    })

    describe('tool calls', () => {
      it('should transform tool_call content to functionCall parts', () => {
        const unified = createUnifiedResponse({
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

        const result = transformResponse(unified)

        expect(result.candidates[0].content.parts).toHaveLength(1)
        expect(result.candidates[0].content.parts[0].functionCall).toEqual({
          name: 'get_weather',
          args: { location: 'NYC' },
        })
      })

      it('should transform multiple tool calls', () => {
        const unified = createUnifiedResponse({
          content: [
            {
              type: 'tool_call',
              toolCall: { id: 'call_1', name: 'tool1', arguments: {} },
            },
            {
              type: 'tool_call',
              toolCall: { id: 'call_2', name: 'tool2', arguments: {} },
            },
          ],
        })

        const result = transformResponse(unified)

        expect(result.candidates[0].content.parts).toHaveLength(2)
        expect(result.candidates[0].content.parts[0].functionCall?.name).toBe('tool1')
        expect(result.candidates[0].content.parts[1].functionCall?.name).toBe('tool2')
      })
    })

    describe('thinking blocks', () => {
      it('should transform thinking to thought parts', () => {
        const unified = createUnifiedResponse({
          thinking: [
            { text: 'Let me think...', signature: 'sig123' },
          ],
          content: [{ type: 'text', text: 'The answer is 42.' }],
        })

        const result = transformResponse(unified)

        expect(result.candidates[0].content.parts).toHaveLength(2)
        expect(result.candidates[0].content.parts[0].thought).toBe(true)
        expect(result.candidates[0].content.parts[0].text).toBe('Let me think...')
        expect(result.candidates[0].content.parts[0].thoughtSignature).toBe('sig123')
        expect(result.candidates[0].content.parts[1].text).toBe('The answer is 42.')
      })

      it('should place thinking parts before content parts', () => {
        const unified = createUnifiedResponse({
          thinking: [{ text: 'Thinking...' }],
          content: [{ type: 'text', text: 'Answer' }],
        })

        const result = transformResponse(unified)

        expect(result.candidates[0].content.parts[0].thought).toBe(true)
        expect(result.candidates[0].content.parts[1].text).toBe('Answer')
      })
    })
  })

  describe('round-trip transformations', () => {
    it('should preserve data through parseResponse → transformResponse', () => {
      const original: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello, world!' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        responseId: 'test_123',
      }

      const unified = parseResponse(original)
      const result = transformResponse(unified)

      expect(result.responseId).toBe(original.responseId)
      expect(result.candidates[0].content.parts[0].text).toBe('Hello, world!')
      expect(result.candidates[0].finishReason).toBe('STOP')
      expect(result.usageMetadata).toEqual(original.usageMetadata)
    })

    it('should preserve tool calls through round-trip', () => {
      const original: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { functionCall: { name: 'get_weather', args: { location: 'NYC' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }

      const unified = parseResponse(original)
      const result = transformResponse(unified)

      expect(result.candidates[0].content.parts[0].functionCall?.name).toBe('get_weather')
      expect(result.candidates[0].content.parts[0].functionCall?.args).toEqual({
        location: 'NYC',
      })
    })

    it('should preserve thinking through round-trip', () => {
      const original: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { thought: true, text: 'Thinking...', thoughtSignature: 'sig123' },
                { text: 'Answer' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }

      const unified = parseResponse(original)
      const result = transformResponse(unified)

      expect(result.candidates[0].content.parts).toHaveLength(2)
      expect(result.candidates[0].content.parts[0].thought).toBe(true)
      expect(result.candidates[0].content.parts[0].text).toBe('Thinking...')
      expect(result.candidates[0].content.parts[0].thoughtSignature).toBe('sig123')
      expect(result.candidates[0].content.parts[1].text).toBe('Answer')
    })
  })
})
