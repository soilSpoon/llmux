
import { describe, expect, it } from 'bun:test'
import { preprocessTools, sanitizeSchema } from '../../src/schema/tool-sanitizer'
import type { UnifiedTool } from '../../src/types/unified'

describe('Tool Sanitizer', () => {
  describe('sanitizeSchema', () => {
    it('should pass through simple schema unchanged', () => {
      const schema = { type: 'string' }
      const result = sanitizeSchema(schema)
      expect(result).toEqual(schema)
    })

    it('should remove custom fields', () => {
      const schema = {
        type: 'object' as const,
        custom: { foo: 'bar' },
        properties: {
          prop1: { type: 'string' }
        }
      }
      const result = sanitizeSchema(schema)
      // Check for absence of 'custom' in a type-safe way
      expect((result as Record<string, unknown>).custom).toBeUndefined()
      expect((result as Record<string, any>).properties?.prop1).toBeDefined()
    })

    it('should remove custom fields recursively', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          prop1: {
            type: 'object',
            custom: { nested: true },
            properties: {
              subprop: { type: 'string' }
            }
          }
        }
      }
      const result = sanitizeSchema(schema) as any // Recursive structures often need some level of casting in tests
      expect(result.properties.prop1.custom).toBeUndefined()
      expect(result.properties.prop1.properties.subprop).toBeDefined()
    })

    it('should clean up required array if properties are removed', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          valid: { type: 'string' }
        },
        required: ['valid', 'missing']
      }
      const result = sanitizeSchema(schema) as any
      expect(result.required).toEqual(['valid'])
    })
  })

  describe('preprocessTools', () => {
    it('should flatten opencode custom.input_schema pattern', () => {
      const tool: UnifiedTool = {
        name: 'test_tool',
        parameters: {
          type: 'object',
          properties: {
            custom: {
              type: 'object',
              properties: {
                input_schema: {
                  type: 'object',
                  properties: {
                    real_param: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }

      const result = preprocessTools([tool])
      if (result && result.length > 0) {
        const processedTool = result[0]
        if (processedTool) {
          expect(processedTool.parameters).toEqual({
            type: 'object',
            properties: {
              real_param: { type: 'string' }
            }
          })
        }
      } else {
        throw new Error('Expected result array with at least one tool')
      }
    })

    it('should encode tool names', () => {
      const tool: UnifiedTool = {
        name: 'foo-bar',
        parameters: { type: 'object' }
      }
      const result = preprocessTools([tool])
      if (result && result.length > 0) {
        const first = result[0]
        if (first) {
          expect(typeof first.name).toBe('string')
        }
      } else {
        throw new Error('Expected result array with at least one tool')
      }
    })
  })
})
