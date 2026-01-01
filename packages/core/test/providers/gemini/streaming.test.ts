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
          id: 'call_123',
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

  describe('error handling edge cases', () => {
    describe('malformed SSE - missing data: prefix variations', () => {
      it('should return null for line without data: prefix', () => {
        const sse = `{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for DATA: (uppercase)', () => {
        const sse = `DATA: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for datas: typo', () => {
        const sse = `datas: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for data without colon', () => {
        const sse = `data {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })
    })

    describe('incomplete/truncated JSON chunks', () => {
      it('should return null for truncated JSON object', () => {
        const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for JSON missing closing brackets', () => {
        const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for empty JSON object', () => {
        const sse = `data: {}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })
    })

    describe('JSON with extra characters before/after', () => {
      it('should return null for JSON with leading garbage', () => {
        const sse = `data: xxx{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should handle JSON with trailing whitespace', () => {
        const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}   `

        const result = parseStreamChunk(sse)

        expect(result).not.toBeNull()
        expect(result?.delta?.text).toBe('Hello')
      })

      it('should handle JSON with trailing newlines', () => {
        const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}\n\n`

        const result = parseStreamChunk(sse)

        expect(result).not.toBeNull()
        expect(result?.delta?.text).toBe('Hello')
      })
    })

    describe('nested SSE (data: data: ...)', () => {
      it('should return null for double data: prefix', () => {
        const sse = `data: data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should return null for data: inside JSON string', () => {
        const sse = `data: {"text":"data: test"}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })
    })

    describe('large chunk handling', () => {
      it('should handle very large text content', () => {
        const largeText = 'A'.repeat(100000)
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: largeText }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe(largeText)
        expect(result?.delta?.text?.length).toBe(100000)
      })

      it('should handle many parts in a single chunk', () => {
        const parts = Array.from({ length: 100 }, (_, i) => ({ text: `part${i}` }))
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts,
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.type).toBe('content')
        expect(result?.delta?.text).toBe(parts.map((p) => p.text).join(''))
      })
    })

    describe('unicode in content', () => {
      it('should handle unicode characters in text', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: '你好世界 🌍 مرحبا العالم' }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.text).toBe('你好世界 🌍 مرحبا العالم')
      })

      it('should handle emoji sequences', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: '👨‍👩‍👧‍👦 👩🏽‍💻 🏳️‍🌈' }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.text).toBe('👨‍👩‍👧‍👦 👩🏽‍💻 🏳️‍🌈')
      })

      it('should handle escaped unicode in JSON', () => {
        const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"\\u4f60\\u597d"}]}}]}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.text).toBe('你好')
      })
    })

    describe('special characters in function arguments', () => {
      it('should handle JSON with nested quotes in args', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'write_file',
                      args: { content: 'He said "Hello"' },
                    },
                  },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.toolCall?.arguments).toEqual({ content: 'He said "Hello"' })
      })

      it('should handle newlines and tabs in function args', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'write_file',
                      args: { content: 'line1\n\tline2\r\nline3' },
                    },
                  },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.toolCall?.arguments).toEqual({ content: 'line1\n\tline2\r\nline3' })
      })

      it('should handle backslashes in function args', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'run_command',
                      args: { path: 'C:\\Users\\test\\file.txt' },
                    },
                  },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.toolCall?.arguments).toEqual({ path: 'C:\\Users\\test\\file.txt' })
      })
    })

    describe('empty candidate content but valid structure', () => {
      it('should handle candidate with empty parts array', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should handle candidate with null parts', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: null,
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })

      it('should handle candidate with undefined content fields', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result).toBeNull()
      })
    })

    describe('multiple candidates in single chunk (should use first)', () => {
      it('should use first candidate when multiple are present', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'First candidate' }],
              },
            },
            {
              content: {
                role: 'model',
                parts: [{ text: 'Second candidate' }],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.text).toBe('First candidate')
      })

      it('should use first candidate even if subsequent have different finish reasons', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'First' }],
              },
              finishReason: 'STOP',
            },
            {
              content: {
                role: 'model',
                parts: [{ text: 'Second' }],
              },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.text).toBe('First')
        expect(result?.stopReason).toBe('end_turn')
      })
    })

    describe('usageMetadata without candidatesTokenCount', () => {
      it('should handle usageMetadata with only promptTokenCount', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
          },
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.usage?.inputTokens).toBe(10)
        expect(result?.usage?.outputTokens).toBeUndefined()
      })

      it('should handle usageMetadata with zero values', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
            totalTokenCount: 0,
          },
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.usage).toEqual({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        })
      })

      it('should handle empty usageMetadata object', () => {
        const chunk = {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {},
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.usage?.inputTokens).toBeUndefined()
        expect(result?.usage?.outputTokens).toBeUndefined()
        })
        })

        describe('partialJson streaming', () => {
        it('should parse functionCall args as partialJson', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'calculate',
                      args: '{"x": 10',
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
        expect(result?.delta?.partialJson).toBe('{"x": 10')
        expect(result?.delta?.toolCall?.name).toBe('calculate')
        })

        it('should handle empty partialJson gracefully', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'test',
                      args: '',
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
        expect(result?.delta?.partialJson).toBe('')
        })

        it('should accumulate partialJson chunks to complete JSON', () => {
        const chunks = [
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'calculate',
                        args: '{"x": 10',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'calculate',
                        args: ', "y": 20',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'calculate',
                        args: '}',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]

        let accumulated = ''
        for (const chunkData of chunks) {
          const result = parseStreamChunk(`data: ${JSON.stringify(chunkData)}`)
          if (result?.delta?.partialJson) {
            accumulated += result.delta.partialJson
          }
        }

        expect(accumulated).toBe('{"x": 10, "y": 20}')
        })

        it('should round-trip partialJson through unified format', () => {
        // Parse Gemini partial JSON function call
        const parseChunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'test',
                      args: '{"key": "val',
                    },
                  },
                ],
              },
            },
          ],
        }

        const parseResult = parseStreamChunk(`data: ${JSON.stringify(parseChunk)}`)
        expect(parseResult?.delta?.partialJson).toBe('{"key": "val')

        // Transform back to Gemini format
        const transformResult = transformStreamChunk(parseResult!)
        const data = JSON.parse(transformResult.replace('data: ', ''))

        expect(data.candidates[0].content.parts[0].functionCall.args).toBe('{"key": "val')
        })

        it('should handle complete JSON objects in function args', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'update_user',
                      args: { id: 123, name: 'Alice', active: true },
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
        expect(result?.delta?.partialJson).toBe('{"id":123,"name":"Alice","active":true}')
        expect(result?.delta?.toolCall?.name).toBe('update_user')
        })

        it('should preserve tool ID during partialJson streaming', () => {
        const chunk = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      id: 'call_xyz789',
                      name: 'get_info',
                      args: '{"param": 1',
                    },
                  },
                ],
              },
            },
          ],
        }
        const sse = `data: ${JSON.stringify(chunk)}`

        const result = parseStreamChunk(sse)

        expect(result?.delta?.partialJson).toBe('{"param": 1')
        expect(result?.delta?.toolCall?.id).toBe('call_xyz789')
        expect(result?.delta?.toolCall?.name).toBe('get_info')
        })
        })
        })

        describe('transformStreamChunk with partialJson', () => {
        it('should transform partialJson chunk to Gemini format', () => {
        const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: '{"location": "NYC',
        },
        }

        const result = transformStreamChunk(chunk)
        const data = JSON.parse(result.replace('data: ', ''))

        expect(data.candidates[0].content.parts[0].functionCall.args).toBe('{"location": "NYC')
        })

        it('should include tool name in partialJson transform if available', () => {
        const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: '{"x": 10',
          toolCall: {
            id: 'call_abc',
            name: 'calculate',
            arguments: '{"x": 10',
          },
        },
        }

        const result = transformStreamChunk(chunk)
        const data = JSON.parse(result.replace('data: ', ''))

        expect(data.candidates[0].content.parts[0].functionCall.name).toBe('calculate')
        expect(data.candidates[0].content.parts[0].functionCall.args).toBe('{"x": 10')
        expect(data.candidates[0].content.parts[0].functionCall.id).toBe('call_abc')
        })

        it('should handle empty partialJson gracefully', () => {
        const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: '',
        },
        }

        const result = transformStreamChunk(chunk)
        const data = JSON.parse(result.replace('data: ', ''))

        expect(data.candidates[0].content.parts[0].functionCall.args).toBe('')
        })

        it('should handle full JSON object in partialJson field', () => {
        const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: '{"action": "login", "user": "alice", "remember": true}',
          toolCall: {
            id: 'call_123',
            name: 'authenticate',
            arguments: '{"action": "login", "user": "alice", "remember": true}',
          },
        },
        }

        const result = transformStreamChunk(chunk)
        const data = JSON.parse(result.replace('data: ', ''))

        expect(data.candidates[0].content.parts[0].functionCall.args).toEqual({
        action: 'login',
        user: 'alice',
        remember: true,
        })
        })

        it('should parse stringified JSON in partialJson', () => {
        const jsonString = '{"query": "SELECT * FROM users WHERE id = 1"}'
        const chunk: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: jsonString,
          toolCall: {
            id: 'call_456',
            name: 'execute_sql',
            arguments: jsonString,
          },
        },
        }

        const result = transformStreamChunk(chunk)
        const data = JSON.parse(result.replace('data: ', ''))

        expect(data.candidates[0].content.parts[0].functionCall.args).toEqual({
        query: 'SELECT * FROM users WHERE id = 1',
        })
        })
        })
        })
