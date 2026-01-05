
import { describe, expect, test } from 'bun:test'
import { parseResponse, extractSignatureFromResponse } from '../response'
import { transform, parse } from '../request'
import type { GeminiResponse, GeminiRequest } from '../types'
import type { UnifiedRequest } from '../../../types/unified'

describe('Gemini HAR Compliance Tests', () => {
  describe('Response Parsing', () => {
    test('should extract thoughtSignature from functionCall part', () => {
      const response: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'Read',
                    args: { path: '/test/file.txt' }
                  },
                  thoughtSignature: 'sig-123-abc'
                }
              ]
            }
          }
        ]
      }

      // Test utility function
      const signature = extractSignatureFromResponse(response)
      expect(signature).toBe('sig-123-abc')

      // Test full parsing
      const unified = parseResponse(response)
      expect(unified.content).toHaveLength(1)
      expect(unified.content[0]!.type).toBe('tool_call')
      expect(unified.content[0]!.thoughtSignature).toBe('sig-123-abc')
    })

    test('should handle subsequent parts without signature', () => {
      const response: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'First', args: {} },
                  thoughtSignature: 'sig-first'
                },
                {
                  functionCall: { name: 'Second', args: {} }
                  // No signature
                }
              ]
            }
          }
        ]
      }

      const unified = parseResponse(response)
      expect(unified.content).toHaveLength(2)
      
      expect(unified.content[0]!.toolCall?.name).toBe('First')
      expect(unified.content[0]!.thoughtSignature).toBe('sig-first')
      
      expect(unified.content[1]!.toolCall?.name).toBe('Second')
      expect(unified.content[1]!.thoughtSignature).toBeUndefined()
    })
  })

  describe('Request Transformation (Thinking Config)', () => {
    test('should transform minimal thinking level to UPPERCASE', () => {
      const unifiedRequest: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        thinking: {
          enabled: false,
          level: 'minimal'
        }
      }

      const geminiRequest = transform(unifiedRequest)
      expect(geminiRequest.generationConfig?.thinkingConfig).toEqual({
        includeThoughts: false,
        thinkingBudget: 0,
        thinkingLevel: 'MINIMAL'
      })
    })

    test('should transform enabled thinking with level', () => {
      const unifiedRequest: UnifiedRequest = {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        thinking: {
          enabled: true,
          level: 'high',
          budget: 1024
        }
      }

      const geminiRequest = transform(unifiedRequest)
      expect(geminiRequest.generationConfig?.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 1024,
        thinkingLevel: 'HIGH'
      })
    })

    test('should parse Gemini thinking config back to Unified', () => {
      const geminiRequest: GeminiRequest = {
        contents: [],
        generationConfig: {
          thinkingConfig: {
            includeThoughts: false,
            thinkingLevel: 'MINIMAL'
          }
        }
      }

      const unified = parse(geminiRequest)
      expect(unified.thinking).toEqual({
        enabled: false,
        level: 'minimal',
        budget: undefined
      })
    })
  })
})
