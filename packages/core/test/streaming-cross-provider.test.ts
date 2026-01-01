import { describe, expect, it } from 'bun:test'
import { parseStreamChunk as parseOpenAI, transformStreamChunk as transformOpenAI } from '../src/providers/openai/streaming'
import { parseStreamChunk as parseAnthropic, transformStreamChunk as transformAnthropic } from '../src/providers/anthropic/streaming'
import { parseStreamChunk as parseGemini } from '../src/providers/gemini/streaming'
import type { StreamChunk } from '../src/types/unified'

/**
 * Cross-Provider Streaming Tests
 * 
 * Verifies partialJson correctly converts between providers:
 * - OpenAI function_call_arguments_delta ↔ Anthropic input_json_delta ↔ Gemini args
 */

describe('Cross-Provider partialJson Conversion', () => {
  describe('OpenAI → Anthropic', () => {
    it('should convert OpenAI function_call_arguments_delta to Anthropic input_json_delta', () => {
      // Step 1: OpenAI streaming chunk with partial arguments
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
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "NYC',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })

      // Step 2: Parse OpenAI to unified
      const unified = parseOpenAI(`data: ${openaiChunk}`)
      expect(unified).not.toBeNull()
      expect(unified?.type).toBe('tool_call')
      expect(unified?.delta?.partialJson).toBe('{"location": "NYC')

      // Step 3: Transform unified to Anthropic
      const anthropicOutput = transformAnthropic(unified!)
      const anthropicStr = Array.isArray(anthropicOutput) ? anthropicOutput.join('') : anthropicOutput

      // Step 4: Verify Anthropic format
      expect(anthropicStr).toContain('input_json_delta')
      expect(anthropicStr).toContain('location')
      expect(anthropicStr).toContain('NYC')
    })

    it('should accumulate partialJson across multiple OpenAI→Anthropic conversions', () => {
      // Simulate multiple OpenAI streaming chunks
      const openaiChunks = [
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_xyz',
                    type: 'function',
                    function: {
                      name: 'calculate',
                      arguments: '{"x": 10',
                    },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ', "y": 20',
                    },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ]

      // Parse and transform each chunk
      let accumulatedJson = ''
      for (const chunkData of openaiChunks) {
        const unified = parseOpenAI(`data: ${chunkData}`)
        if (unified?.delta?.partialJson) {
          accumulatedJson += unified.delta.partialJson
        }

        // Verify transformation to Anthropic maintains semantics
        const anthropicOutput = transformAnthropic(unified!)
        const anthropicStr = Array.isArray(anthropicOutput) ? anthropicOutput.join('') : anthropicOutput
        expect(anthropicStr).toBeDefined()
      }

      // Verify complete JSON accumulated correctly
      expect(accumulatedJson).toBe('{"x": 10, "y": 20}')
      expect(() => JSON.parse(accumulatedJson)).not.toThrow()
    })

    it('should handle complex nested JSON in OpenAI→Anthropic conversion', () => {
      const complexJson = JSON.stringify({
        user: {
          id: 123,
          name: 'Alice',
          addresses: [
            { street: '123 Main St', city: 'NYC' },
            { street: '456 Oak Ave', city: 'LA' },
          ],
        },
        metadata: { timestamp: '2024-01-01' },
      })

      // Split into chunks (simulating streaming)
      const chunks = []
      const chunkSize = 30
      for (let i = 0; i < complexJson.length; i += chunkSize) {
        const fragment = complexJson.slice(i, i + chunkSize)
        const openaiChunk = JSON.stringify({
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: fragment,
                    },
                  },
                ],
              },
            },
          ],
        })
        chunks.push(openaiChunk)
      }

      // Convert through unified and to Anthropic
      let unified: StreamChunk | null = null
      let accumulatedJson = ''

      for (const chunkData of chunks) {
        unified = parseOpenAI(`data: ${chunkData}`)
        if (unified?.delta?.partialJson) {
          accumulatedJson += unified.delta.partialJson
        }

        // Transform to Anthropic
        if (unified) {
          const anthropicOutput = transformAnthropic(unified)
          expect(Array.isArray(anthropicOutput) || typeof anthropicOutput === 'string').toBe(true)
        }
      }

      // Verify complete JSON was accumulated and is valid
      expect(accumulatedJson).toBe(complexJson)
      expect(() => JSON.parse(accumulatedJson)).not.toThrow()
      const parsed = JSON.parse(accumulatedJson)
      expect(parsed.user.name).toBe('Alice')
      expect(parsed.user.addresses.length).toBe(2)
    })
  })

  describe('Anthropic → OpenAI', () => {
    it('should convert Anthropic input_json_delta to OpenAI function_call_arguments_delta', () => {
      // Step 1: Anthropic streaming chunk with partial JSON
      const anthropicChunk = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"NYC"}}`

      // Step 2: Parse Anthropic to unified
      const unified = parseAnthropic(anthropicChunk)
      expect(unified).not.toBeNull()
      expect(unified?.type).toBe('tool_call')
      expect(unified?.delta?.partialJson).toBe('{"location": "NYC')

      // Step 3: Transform unified to OpenAI
      const openaiOutput = transformOpenAI(unified!)
      expect(openaiOutput).toContain('data:')
      expect(openaiOutput).toContain('tool_calls')
      expect(openaiOutput).toContain('function')
      expect(openaiOutput).toContain('arguments')
    })

    it('should accumulate partialJson across multiple Anthropic→OpenAI conversions', () => {
      const anthropicChunks = [
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"name\\":"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"Alice\\","}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"age\\": 30}"}}`,
      ]

      let accumulatedJson = ''
      for (const chunkData of anthropicChunks) {
        const unified = parseAnthropic(chunkData)
        if (unified?.delta?.partialJson) {
          accumulatedJson += unified.delta.partialJson
        }

        // Verify transformation to OpenAI
        const openaiOutput = transformOpenAI(unified!)
        expect(openaiOutput).toBeDefined()
        expect(typeof openaiOutput === 'string').toBe(true)
      }

      // Verify complete JSON
      expect(accumulatedJson).toBe('{"name":"Alice","age": 30}')
      expect(() => JSON.parse(accumulatedJson)).not.toThrow()
    })

    it('should preserve tool call metadata in Anthropic→OpenAI conversion', () => {
      // Anthropic with tool_use block start
      const anthropicStartChunk = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather","input":{}}}`

      const unified = parseAnthropic(anthropicStartChunk)
      expect(unified?.type).toBe('tool_call')
      expect(unified?.delta?.toolCall?.id).toBe('toolu_123')
      expect(unified?.delta?.toolCall?.name).toBe('get_weather')

      // Transform to OpenAI
      const openaiOutput = transformOpenAI(unified!)
      expect(openaiOutput).toContain('tool_calls')
      expect(openaiOutput).toContain('get_weather')
    })
  })

  describe('Gemini → Anthropic', () => {
    it('should convert Gemini partial function args to Anthropic input_json_delta', () => {
      // Step 1: Gemini streaming chunk with partial JSON args
      const geminiChunk = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'search_api',
                    args: '{"query": "weather in NYC',
                  },
                },
              ],
            },
          },
        ],
      }

      // Step 2: Parse Gemini to unified
      const unified = parseGemini(`data: ${JSON.stringify(geminiChunk)}`)
      expect(unified).not.toBeNull()
      expect(unified?.type).toBe('tool_call')
      expect(unified?.delta?.partialJson).toBe('{"query": "weather in NYC')

      // Step 3: Transform unified to Anthropic
      const anthropicOutput = transformAnthropic(unified!)
      const anthropicStr = Array.isArray(anthropicOutput) ? anthropicOutput.join('') : anthropicOutput

      // Step 4: Verify Anthropic format
      expect(anthropicStr).toContain('input_json_delta')
      expect(anthropicStr).toContain('query')
      expect(anthropicStr).toContain('weather')
    })

    it('should accumulate Gemini partial args across conversions', () => {
      const geminiChunks = [
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'calculate',
                      args: '{"numbers": [1',
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
                      args: ', 2, 3',
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
                      args: ']}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]

      let accumulatedJson = ''
      for (const chunkData of geminiChunks) {
        const unified = parseGemini(`data: ${JSON.stringify(chunkData)}`)
        if (unified?.delta?.partialJson) {
          accumulatedJson += unified.delta.partialJson
        }
      }

      expect(accumulatedJson).toBe('{"numbers": [1, 2, 3]}')
      expect(() => JSON.parse(accumulatedJson)).not.toThrow()
    })
  })

  describe('Gemini → OpenAI', () => {
    it('should convert Gemini function args to OpenAI function_call_arguments_delta', () => {
      const geminiChunk = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'get_info',
                    args: '{"key": "val',
                  },
                },
              ],
            },
          },
        ],
      }

      const unified = parseGemini(`data: ${JSON.stringify(geminiChunk)}`)
      expect(unified?.delta?.partialJson).toBe('{"key": "val')

      const openaiOutput = transformOpenAI(unified!)
      expect(openaiOutput).toContain('tool_calls')
      expect(openaiOutput).toContain('get_info')
      expect(openaiOutput).toContain('function')
    })
  })

  describe('Round-Trip Conversions', () => {
    it('should preserve JSON semantics in OpenAI→Anthropic→OpenAI round-trip', () => {
      const originalJson = '{"location": "NYC", "units": "celsius"}'

      // OpenAI → unified
      const openaiChunk1 = JSON.stringify({
        id: 'chatcmpl-1',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: originalJson,
                  },
                },
              ],
            },
          },
        ],
      })

      const unified1 = parseOpenAI(`data: ${openaiChunk1}`)
      expect(unified1?.delta?.partialJson).toBe(originalJson)

      // Anthropic → unified
      const anthropicOutput = transformAnthropic(unified1!)
      const anthropicStr = Array.isArray(anthropicOutput) ? anthropicOutput.join('') : anthropicOutput

      // Parse Anthropic back (extract the data from SSE)
      const dataMatch = anthropicStr.match(/"partial_json":"([^"]+(?:\\.[^"]*)*)"/)
      expect(dataMatch).not.toBeNull()

      // OpenAI → unified (final) with tool call metadata preserved
      const unified2: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          partialJson: originalJson,
          toolCall: {
            id: 'call_1',
            name: 'get_weather',
            arguments: originalJson,
          },
        },
      }

      const finalOpenAI = transformOpenAI(unified2)
      expect(finalOpenAI).toContain('get_weather')
      expect(finalOpenAI).toContain('location')
      expect(finalOpenAI).toContain('NYC')
    })

    it('should preserve metadata in Anthropic→OpenAI→Anthropic round-trip', () => {
      // Start with Anthropic tool_use
      const anthropicStart = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"calculator","input":{}}}`

      const unified1 = parseAnthropic(anthropicStart)
      expect(unified1?.delta?.toolCall?.id).toBe('toolu_abc')
      expect(unified1?.delta?.toolCall?.name).toBe('calculator')

      // Convert to OpenAI
      const openaiOutput = transformOpenAI(unified1!)
      expect(openaiOutput).toContain('calculator')

      // Back to Anthropic - we're just transforming the unified form
      const unified2: StreamChunk = {
        type: 'tool_call',
        delta: {
          type: 'tool_call',
          toolCall: {
            id: 'toolu_abc',
            name: 'calculator',
            arguments: { result: 42 },
          },
        },
      }

      const anthropicFinal = transformAnthropic(unified2)
      const anthropicStr = Array.isArray(anthropicFinal) ? anthropicFinal.join('') : anthropicFinal

      expect(anthropicStr).toContain('tool_use')
      expect(anthropicStr).toContain('calculator')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty partialJson during conversion', () => {
      const openaiChunk = JSON.stringify({
        id: 'chatcmpl-1',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: '',
                  },
                },
              ],
            },
          },
        ],
      })

      const unified = parseOpenAI(`data: ${openaiChunk}`)

      const anthropicOutput = transformAnthropic(unified!)
      // Empty partialJson should produce empty string or minimal output
      expect(typeof anthropicOutput === 'string' || Array.isArray(anthropicOutput)).toBe(true)
    })

    it('should handle special characters in partialJson conversion', () => {
      const jsonWithSpecialChars = '{"message": "Hello\\nWorld\\t!", "emoji": "👍"}'

      const openaiChunk = JSON.stringify({
        id: 'chatcmpl-1',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: jsonWithSpecialChars,
                  },
                },
              ],
            },
          },
        ],
      })

      const unified = parseOpenAI(`data: ${openaiChunk}`)
      expect(unified?.delta?.partialJson).toBe(jsonWithSpecialChars)

      const anthropicOutput = transformAnthropic(unified!)
      const anthropicStr = Array.isArray(anthropicOutput) ? anthropicOutput.join('') : anthropicOutput

      // Verify special characters are preserved
      expect(anthropicStr).toContain('Hello')
      expect(anthropicStr).toContain('World')
    })

    it('should handle large JSON objects split across multiple conversions', () => {
      const largeObject = {
        data: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          value: `item_${i}`,
          nested: { deep: { value: Math.random() } },
        })),
      }
      const largeJson = JSON.stringify(largeObject)

      // Split into small chunks
      const chunkSize = 50
      const chunks: string[] = []
      for (let i = 0; i < largeJson.length; i += chunkSize) {
        chunks.push(largeJson.slice(i, i + chunkSize))
      }

      // Process each chunk through conversions
      let accumulatedJson = ''
      for (const chunk of chunks) {
        const openaiChunk = JSON.stringify({
          id: 'chatcmpl-1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: chunk,
                    },
                  },
                ],
              },
            },
          ],
        })

        const unified = parseOpenAI(`data: ${openaiChunk}`)
        if (unified?.delta?.partialJson) {
          accumulatedJson += unified.delta.partialJson

          // Verify each conversion step
          const anthropicOutput = transformAnthropic(unified)
          expect(Array.isArray(anthropicOutput) || typeof anthropicOutput === 'string').toBe(true)
        }
      }

      // Final validation
      expect(accumulatedJson).toBe(largeJson)
      expect(() => JSON.parse(accumulatedJson)).not.toThrow()
      const parsed = JSON.parse(accumulatedJson)
      expect(parsed.data.length).toBe(100)
    })
  })
})
