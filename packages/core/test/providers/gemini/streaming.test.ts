import { describe, expect, it } from 'bun:test'
import { parseStreamChunk, transformStreamChunk } from '../../../src/providers/gemini/streaming'
import type { StreamChunk } from '../../../src/types/unified'

describe('Gemini Streaming Transformations', () => {
  describe('parseStreamChunk', () => {
    describe('SSE parsing', () => {
      it('should parse SSE data: prefix', () => {
        const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).not.toBeNull()
        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe('Hello')
      })

      it('should handle data: with extra whitespace', () => {
        const sse = `data:   {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).not.toBeNull()
        expect(result?.delta?.text).toBe('Hi')
      })

      it('should return null for empty data', () => {
        const sse = `data: `

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for [DONE] marker', () => {
        const sse = `data: [DONE]`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for non-data lines', () => {
        expect(parseStreamChunk('')).toBeNull()
        expect(parseStreamChunk(':')).toBeNull()
        expect(parseStreamChunk('event: message')).toBeNull()
      })

      it('should handle invalid JSON gracefully', () => {
        const sse = `data: {invalid json}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })
    })

    describe('text content', () => {
      it('should parse text content chunks', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello, world!' }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe('Hello, world!')
      })

      it('should concatenate multiple text parts', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello' }, { text: ' world' }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.text).toBe('Hello world')
      })

      it('should handle empty text', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: '' }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe('')
      })
    })

    describe('function calls', () => {
      it('should parse functionCall parts', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'NYC' },
                    },
                  },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('tool_call')
        expect(result?.delta?.toolCall?.name).toBe('get_weather')
        expect(result?.delta?.toolCall?.arguments).toEqual({ location: 'NYC' })
      })

      it('should generate id for function call', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'test', args: {} } },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.toolCall?.id).toBeDefined()
      })
    })

    describe('thinking content', () => {
      it('should parse thought parts as thinking', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { thought: true, text: 'Let me think...', thoughtSignature: 'sig' },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('thinking')
        expect(result?.delta?.thinking?.text).toBe('Let me think...')
        expect(result?.delta?.thinking?.signature).toBe('sig')
      })
    })

    describe('finish reason', () => {
      it('should include stopReason when finishReason is present', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Done' }] },
              finishReason: 'STOP',
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.stopReason).toBe('end_turn')
      })

      it('should map MAX_TOKENS to max_tokens', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Cut' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.stopReason).toBe('max_tokens')
      })

      it('should detect tool_use when functionCall present', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ functionCall: { name: 'test', args: {} } }],
              },
              finishReason: 'STOP',
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.stopReason).toBe('tool_use')
      })
    })

    describe('usage metadata', () => {
      it('should include usage when usageMetadata is present', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.usage).toEqual({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        })
      })

      it('should include thinkingTokens in usage', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 230,
            thoughtsTokenCount: 200,
          },
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.usage?.thinkingTokens).toBe(200)
      })
    })

    describe('done signal', () => {
      it('should return done when finishReason is present with no content', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('done')
        expect(result?.stopReason).toBe('end_turn')
      })
    })

    describe('edge cases', () => {
      it('should handle missing candidates', () => {
        const chunk = { usageMetadata: { promptTokenCount: 10 } }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should handle empty candidates array', () => {
        const chunk = { candidates: [] }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should handle missing content', () => {
        const chunk = { candidates: [{ finishReason: 'STOP' }] }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        // Should return done chunk when finishReason present but no content
        expect(result).not.toBeNull()
        expect(result?.type).toBe('done')
        expect(result?.stopReason).toBe('end_turn')
      })
    })
  })

  describe('transformStreamChunk', () => {
    describe('content chunks', () => {
      it('should transform content chunk to SSE', () => {
        const chunk: StreamChunk = {
          type: 'content',
          delta: { type: 'text', text: 'Hello' },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toMatch(/^data: /)
        const parsed = JSON.parse(result.replace('data: ', ''))
        expect(parsed.candidates[0].content.parts[0].text).toBe('Hello')
      })

      it('should include role as model', () => {
        const chunk: StreamChunk = {
          type: 'content',
          delta: { type: 'text', text: 'Hi' },
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.candidates[0].content.role).toBe('model')
      })
    })

    describe('tool_call chunks', () => {
      it('should transform tool_call chunk to SSE', () => {
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

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.candidates[0].content.parts[0].functionCall).toEqual({
          name: 'get_weather',
          args: { location: 'NYC' },
        })
      })
    })

    describe('thinking chunks', () => {
      it('should transform thinking chunk to SSE', () => {
        const chunk: StreamChunk = {
          type: 'thinking',
          delta: {
            type: 'thinking',
            thinking: { text: 'Thinking...', signature: 'sig123' },
          },
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.candidates[0].content.parts[0]).toEqual({
          thought: true,
          text: 'Thinking...',
          thoughtSignature: 'sig123',
        })
      })
    })

    describe('done chunks', () => {
      it('should transform done chunk with stopReason', () => {
        const chunk: StreamChunk = {
          type: 'done',
          stopReason: 'end_turn',
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.candidates[0].finishReason).toBe('STOP')
      })

      it('should include usage in done chunk', () => {
        const chunk: StreamChunk = {
          type: 'done',
          stopReason: 'end_turn',
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.usageMetadata).toEqual({
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        })
      })
    })

    describe('usage chunks', () => {
      it('should transform usage chunk to SSE', () => {
        const chunk: StreamChunk = {
          type: 'usage',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.usageMetadata).toEqual({
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        })
      })
    })

    describe('error chunks', () => {
      it('should transform error chunk to SSE', () => {
        const chunk: StreamChunk = {
          type: 'error',
          error: 'Something went wrong',
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', ''))

        expect(parsed.error).toBe('Something went wrong')
      })
    })

    describe('round-trip', () => {
      it('should preserve text content through transform → parse', () => {
        const original: StreamChunk = {
          type: 'content',
          delta: { type: 'text', text: 'Hello, world!' },
        }

        const sse = transformStreamChunk(original)
        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe('Hello, world!')
      })

      it('should preserve tool_call through round-trip', () => {
        const original: StreamChunk = {
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

        const sse = transformStreamChunk(original)
        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('tool_call')
        expect(result?.delta?.toolCall?.name).toBe('get_weather')
        expect(result?.delta?.toolCall?.arguments).toEqual({ location: 'NYC' })
      })

      it('should preserve thinking through round-trip', () => {
        const original: StreamChunk = {
          type: 'thinking',
          delta: {
            type: 'thinking',
            thinking: { text: 'Let me think...', signature: 'sig123' },
          },
        }

        const sse = transformStreamChunk(original)
        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('thinking')
        expect(result?.delta?.thinking?.text).toBe('Let me think...')
        expect(result?.delta?.thinking?.signature).toBe('sig123')
      })
    })
  })
})
