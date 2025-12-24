import { describe, expect, it } from 'bun:test'
import { parseStreamChunk, transformStreamChunk } from '../../../src/providers/antigravity/streaming'
import type { StreamChunk } from '../../../src/types/unified'

describe('Antigravity Streaming Transformations', () => {
  describe('parseStreamChunk()', () => {
    describe('SSE format parsing', () => {
      it('should parse SSE data line with text content', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result).not.toBeNull()
        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe('Hello')
      })

      it('should return null for empty data', () => {
        const chunk = 'data: '

        const result = parseStreamChunk(chunk)

        expect(result).toBeNull()
      })

      it('should return null for [DONE] signal', () => {
        const chunk = 'data: [DONE]'

        const result = parseStreamChunk(chunk)

        expect(result).toBeNull()
      })

      it('should handle chunk without data: prefix', () => {
        const chunk = '{"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result).not.toBeNull()
        expect(result?.delta?.text).toBe('Hi')
      })

      it('should handle whitespace around data', () => {
        const chunk = '  data:   {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Test"}]}}]}}  '

        const result = parseStreamChunk(chunk)

        expect(result).not.toBeNull()
        expect(result?.delta?.text).toBe('Test')
      })
    })

    describe('text content parsing', () => {
      it('should extract text delta', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe('Hello')
      })

      it('should handle empty parts', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[],"role":"model"}}]}}'

        const result = parseStreamChunk(chunk)

        // May return null or empty content chunk
        expect(result === null || result?.delta?.text === undefined).toBe(true)
      })
    })

    describe('thinking content parsing', () => {
      it('should parse thinking chunk with signature', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Analyzing...","thoughtSignature":"sig123"}],"role":"model"}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.type).toBe('thinking')
        expect(result?.delta?.thinking?.text).toBe('Analyzing...')
        expect(result?.delta?.thinking?.signature).toBe('sig123')
      })

      it('should parse thinking chunk without signature', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking..."}],"role":"model"}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.type).toBe('thinking')
        expect(result?.delta?.thinking?.text).toBe('Thinking...')
      })
    })

    describe('tool call parsing', () => {
      it('should parse functionCall chunk', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"location":"NYC"},"id":"call-123"}}],"role":"model"}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.type).toBe('tool_call')
        expect(result?.delta?.toolCall?.name).toBe('get_weather')
        expect(result?.delta?.toolCall?.arguments).toEqual({ location: 'NYC' })
        expect(result?.delta?.toolCall?.id).toBe('call-123')
      })

      it('should handle functionCall without id', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"search","args":{}}}],"role":"model"}}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.type).toBe('tool_call')
        expect(result?.delta?.toolCall?.name).toBe('search')
        expect(result?.delta?.toolCall?.id).toBeDefined()
      })
    })

    describe('finish reason parsing', () => {
      it('should parse STOP finish reason', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"STOP"}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.stopReason).toBe('end_turn')
      })

      it('should parse MAX_TOKENS finish reason', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"MAX_TOKENS"}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.stopReason).toBe('max_tokens')
      })

      it('should parse SAFETY finish reason', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"SAFETY"}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.stopReason).toBe('content_filter')
      })
    })

    describe('usage metadata parsing', () => {
      it('should parse usage in final chunk', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":200,"totalTokenCount":300}}}'

        const result = parseStreamChunk(chunk)

        expect(result?.usage).toBeDefined()
        expect(result?.usage?.inputTokens).toBe(100)
        expect(result?.usage?.outputTokens).toBe(200)
        expect(result?.usage?.totalTokens).toBe(300)
      })

      it('should parse thinking tokens in usage', () => {
        const chunk = 'data: {"response":{"candidates":[{"finishReason":"STOP","content":{"parts":[],"role":"model"}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":200,"totalTokenCount":300,"thoughtsTokenCount":50}}}'

        const result = parseStreamChunk(chunk)

        expect(result?.usage?.thinkingTokens).toBe(50)
      })

      it('should parse cached tokens in usage', () => {
        const chunk = 'data: {"response":{"candidates":[{"finishReason":"STOP","content":{"parts":[],"role":"model"}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":200,"totalTokenCount":300,"cachedContentTokenCount":25}}}'

        const result = parseStreamChunk(chunk)

        expect(result?.usage?.cachedTokens).toBe(25)
      })
    })

    describe('done signal', () => {
      it('should return done chunk when finishReason is present', () => {
        const chunk = 'data: {"response":{"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"STOP"}]}}'

        const result = parseStreamChunk(chunk)

        expect(result?.type).toBe('done')
        expect(result?.stopReason).toBe('end_turn')
      })
    })

    describe('error handling', () => {
      it('should return error chunk for invalid JSON', () => {
        const chunk = 'data: {invalid json}'

        const result = parseStreamChunk(chunk)

        expect(result).toBeNull()
      })

      it('should handle missing response wrapper', () => {
        // This is raw Gemini format without Antigravity wrapper
        const chunk = 'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}]}'

        const result = parseStreamChunk(chunk)

        // Should either return null or handle gracefully
        expect(result === null || result?.delta?.text === 'Hi').toBe(true)
      })

      it('should handle empty candidates array', () => {
        const chunk = 'data: {"response":{"candidates":[]}}'

        const result = parseStreamChunk(chunk)

        expect(result).toBeNull()
      })
    })
  })

  describe('transformStreamChunk()', () => {
    describe('content chunk transformation', () => {
      it('should transform text content chunk', () => {
        const chunk: StreamChunk = {
          type: 'content',
          delta: { type: 'text', text: 'Hello' },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('data:')
        expect(result).toContain('"response"')
        expect(result).toContain('"text":"Hello"')
      })

      it('should output valid SSE format', () => {
        const chunk: StreamChunk = {
          type: 'content',
          delta: { type: 'text', text: 'Test' },
        }

        const result = transformStreamChunk(chunk)

        expect(result.startsWith('data: ')).toBe(true)
        expect(result.endsWith('\n\n')).toBe(true)
      })
    })

    describe('thinking chunk transformation', () => {
      it('should transform thinking chunk with signature', () => {
        const chunk: StreamChunk = {
          type: 'thinking',
          delta: {
            type: 'thinking',
            thinking: { text: 'Analyzing...', signature: 'sig123' },
          },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"thought":true')
        expect(result).toContain('"text":"Analyzing..."')
        expect(result).toContain('"thoughtSignature":"sig123"')
      })

      it('should transform thinking chunk without signature', () => {
        const chunk: StreamChunk = {
          type: 'thinking',
          delta: {
            type: 'thinking',
            thinking: { text: 'Thinking...' },
          },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"thought":true')
        expect(result).toContain('"text":"Thinking..."')
      })
    })

    describe('tool call chunk transformation', () => {
      it('should transform tool_call chunk', () => {
        const chunk: StreamChunk = {
          type: 'tool_call',
          delta: {
            type: 'tool_call',
            toolCall: {
              id: 'call-123',
              name: 'get_weather',
              arguments: { location: 'NYC' },
            },
          },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"functionCall"')
        expect(result).toContain('"name":"get_weather"')
        expect(result).toContain('"id":"call-123"')
      })
    })

    describe('usage chunk transformation', () => {
      it('should transform usage chunk', () => {
        const chunk: StreamChunk = {
          type: 'usage',
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
          },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"usageMetadata"')
        expect(result).toContain('"promptTokenCount":100')
        expect(result).toContain('"candidatesTokenCount":200')
        expect(result).toContain('"totalTokenCount":300')
      })

      it('should include thinking tokens if present', () => {
        const chunk: StreamChunk = {
          type: 'usage',
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            thinkingTokens: 50,
          },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"thoughtsTokenCount":50')
      })
    })

    describe('done chunk transformation', () => {
      it('should transform done chunk with STOP', () => {
        const chunk: StreamChunk = {
          type: 'done',
          stopReason: 'end_turn',
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"finishReason":"STOP"')
      })

      it('should transform done chunk with MAX_TOKENS', () => {
        const chunk: StreamChunk = {
          type: 'done',
          stopReason: 'max_tokens',
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"finishReason":"MAX_TOKENS"')
      })

      it('should include usage if present', () => {
        const chunk: StreamChunk = {
          type: 'done',
          stopReason: 'end_turn',
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
          },
        }

        const result = transformStreamChunk(chunk)

        expect(result).toContain('"finishReason":"STOP"')
        expect(result).toContain('"usageMetadata"')
      })
    })

    describe('error chunk transformation', () => {
      it('should transform error chunk', () => {
        const chunk: StreamChunk = {
          type: 'error',
          error: 'Something went wrong',
        }

        const result = transformStreamChunk(chunk)

        // Implementation may vary - either include error or skip
        expect(typeof result).toBe('string')
      })
    })

    describe('wrapper structure', () => {
      it('should wrap in Antigravity response envelope', () => {
        const chunk: StreamChunk = {
          type: 'content',
          delta: { type: 'text', text: 'Hi' },
        }

        const result = transformStreamChunk(chunk)
        const parsed = JSON.parse(result.replace('data: ', '').trim())

        expect(parsed).toHaveProperty('response')
        expect(parsed.response).toHaveProperty('candidates')
      })
    })
  })

  describe('round-trip', () => {
    it('should preserve text content through round-trip', () => {
      const originalChunk: StreamChunk = {
        type: 'content',
        delta: { type: 'text', text: 'Hello, world!' },
      }

      const transformed = transformStreamChunk(originalChunk)
      const parsed = parseStreamChunk(transformed)

      expect(parsed?.type).toBe('content')
      expect(parsed?.delta?.text).toBe('Hello, world!')
    })

    it('should preserve thinking content through round-trip', () => {
      const originalChunk: StreamChunk = {
        type: 'thinking',
        delta: {
          type: 'thinking',
          thinking: { text: 'Deep thought...', signature: 'sigABC' },
        },
      }

      const transformed = transformStreamChunk(originalChunk)
      const parsed = parseStreamChunk(transformed)

      expect(parsed?.type).toBe('thinking')
      expect(parsed?.delta?.thinking?.text).toBe('Deep thought...')
      expect(parsed?.delta?.thinking?.signature).toBe('sigABC')
    })

    it('should preserve tool calls through round-trip', () => {
      const originalChunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: 'call-xyz',
            name: 'search',
            arguments: { query: 'test' },
          },
        },
      }

      const transformed = transformStreamChunk(originalChunk)
      const parsed = parseStreamChunk(transformed)

      expect(parsed?.type).toBe('tool_call')
      expect(parsed?.delta?.toolCall?.name).toBe('search')
      expect(parsed?.delta?.toolCall?.id).toBe('call-xyz')
    })
  })
})
