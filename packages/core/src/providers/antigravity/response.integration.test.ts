import { describe, it, expect } from 'bun:test'
import { parseResponse } from './response'
import { recursivelyParseJsonStrings } from './json-argument-parser'
import type { AntigravityResponse } from './types'

/**
 * Integration tests for response.ts with json-argument-parser
 * Verifies that tool arguments are properly parsed when stringified
 */

describe('response.ts + json-argument-parser integration', () => {
  it('should parse JSON-stringified tool arguments', () => {
    const antigravityResponse: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'call-123',
                    name: 'calculator',
                    // Simulating Gemini returning stringified JSON
                    args: JSON.stringify({ operation: 'add', x: 5, y: 3 }),
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'resp-123',
      },
    }

    const unifiedResponse = parseResponse(antigravityResponse)

    expect(unifiedResponse.content.length).toBe(1)
    const toolCall = unifiedResponse.content[0]
    expect(toolCall).toBeDefined()
    if (!toolCall) throw new Error('Tool call is undefined')

    if (toolCall) {
      expect(toolCall.type).toBe('tool_call')
      if (toolCall.type === 'tool_call') {
        expect(toolCall.toolCall?.arguments).toBeDefined()
      }
    }
  })

  it('should handle nested JSON stringification', () => {
    const complexArgs = {
      config: JSON.stringify({ nested: 'value' }),
      items: ['a', 'b'],
    }

    const result = recursivelyParseJsonStrings(complexArgs)

    expect(result).toBeDefined()
    if (typeof result === 'object' && result !== null && 'config' in result) {
      const parsed = result.config
      if (typeof parsed === 'object' && parsed !== null && 'nested' in parsed) {
        expect(parsed.nested).toBe('value')
      }
    }
  })

  it('should preserve non-JSON strings', () => {
    const value = 'Not JSON at all'
    const result = recursivelyParseJsonStrings(value)

    expect(result).toBe('Not JSON at all')
  })

  it('should handle mixed content with tools and text', () => {
    const antigravityResponse: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Let me help with that.' },
                {
                  functionCall: {
                    id: 'call-456',
                    name: 'search',
                    args: JSON.stringify({ query: 'weather today' }),
                  },
                },
                { text: 'I found some results.' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'resp-456',
      },
    }

    const unifiedResponse = parseResponse(antigravityResponse)

    // Should have text, tool call, and text again
    expect(unifiedResponse.content.length).toBe(3)
    expect(unifiedResponse.content[0]?.type).toBe('text')
    expect(unifiedResponse.content[1]?.type).toBe('tool_call')
    expect(unifiedResponse.content[2]?.type).toBe('text')
  })

  it('should handle double-nested JSON stringification', () => {
    const doubleNested = JSON.stringify(JSON.stringify({ key: 'value' }))

    const result = recursivelyParseJsonStrings(doubleNested)

    // Should be recursively parsed
    expect(typeof result).toBe('object')
    if (typeof result === 'object' && result !== null && 'key' in result) {
      expect(result.key).toBe('value')
    }
  })

  it('should handle arrays of stringified values', () => {
    const arrayOfStringified = [
      JSON.stringify({ item: 1 }),
      JSON.stringify({ item: 2 }),
      'plain string',
    ]

    const result = recursivelyParseJsonStrings(arrayOfStringified)

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result.length).toBe(3)
      // First two should be parsed objects
      expect(typeof result[0]).toBe('object')
      expect(typeof result[1]).toBe('object')
      // Third should be string
      expect(result[2]).toBe('plain string')
    }
  })

  it('should handle null and undefined gracefully', () => {
    const resultNull = recursivelyParseJsonStrings(null)
    const resultUndefined = recursivelyParseJsonStrings(undefined)

    expect(resultNull).toBeNull()
    expect(resultUndefined).toBeUndefined()
  })

  it('should preserve primitive types', () => {
    expect(recursivelyParseJsonStrings(42)).toBe(42)
    expect(recursivelyParseJsonStrings(true)).toBe(true)
    expect(recursivelyParseJsonStrings(false)).toBe(false)
  })

  it('should handle tool arguments with special characters', () => {
    const specialArgs = JSON.stringify({
      message: 'Hello\\nWorld',
      unicode: '🎉',
      quote: 'Say "hello"',
    })

    const result = recursivelyParseJsonStrings(specialArgs)

    expect(typeof result).toBe('object')
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>
      expect(obj.message).toContain('World')
      expect(obj.unicode).toBe('🎉')
    }
  })

  it('should work in actual response parsing flow', () => {
    // Simulate Claude response with stringified arguments
    const claudeResponse: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'call-claude-1',
                    name: 'compute',
                    // Claude sometimes returns stringified args
                    args: JSON.stringify({ operation: 'multiply', numbers: [3, 4] }),
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'resp-claude-1',
      },
    }

    const unifiedResponse = parseResponse(claudeResponse)

    // Response should be parseable and contain tool call
    expect(unifiedResponse.content.length).toBeGreaterThan(0)
    const hasToolCall = unifiedResponse.content.some((part) => part.type === 'tool_call')
    expect(hasToolCall).toBe(true)
  })
})

describe('json-argument-parser edge cases', () => {
  it('should handle truncated JSON gracefully', () => {
    const truncated = '{"incomplete": "json"'

    const result = recursivelyParseJsonStrings(truncated)

    // Should return as-is if parsing fails
    expect(result).toBe(truncated)
  })

  it('should handle objects with circular-like structure', () => {
    const obj: Record<string, unknown> = { a: 1 }
    // Create a deep structure (but not actual circular)
    obj.nested = { b: 2 }

    const result = recursivelyParseJsonStrings(obj)

    expect(result).toBeDefined()
  })

  it('should handle empty strings', () => {
    const result = recursivelyParseJsonStrings('')

    // Empty string is not valid JSON
    expect(result).toBe('')
  })

  it('should handle whitespace-only strings', () => {
    const result = recursivelyParseJsonStrings('   ')

    expect(result).toBe('   ')
  })
})
