import { describe, expect, it } from 'bun:test'
import { sanitizeSchema } from '../../src/schema/sanitize'
import type { JSONSchemaProperty } from '../../src/types/unified'

describe('sanitizeSchema', () => {
  describe('allowlist fields', () => {
    it('should keep allowed fields: type, properties, required, description, enum, items, additionalProperties', () => {
      const input: JSONSchemaProperty = {
        type: 'object',
        description: 'A test object',
        properties: {
          name: { type: 'string', description: 'User name' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
        additionalProperties: false,
      }

      const result = sanitizeSchema(input)

      expect(result.type).toBe('object')
      expect(result.description).toBe('A test object')
      expect(result.properties?.name?.type).toBe('string')
      expect(result.required).toEqual(['name'])
      expect(result.additionalProperties).toBe(false)
    })

    it('should keep anyOf, oneOf, allOf compositions', () => {
      const input: JSONSchemaProperty = {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      }

      const result = sanitizeSchema(input)

      expect(result.anyOf).toHaveLength(2)
      expect(result.anyOf?.[0].type).toBe('string')
    })
  })

  describe('remove disallowed fields', () => {
    it('should remove $schema field', () => {
      const input = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect((result as Record<string, unknown>).$schema).toBeUndefined()
      expect(result.type).toBe('object')
    })

    it('should remove $id field', () => {
      const input = {
        $id: 'https://example.com/schema',
        type: 'string',
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect((result as Record<string, unknown>).$id).toBeUndefined()
    })

    it('should remove default field', () => {
      const input = {
        type: 'string',
        default: 'hello',
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect((result as Record<string, unknown>).default).toBeUndefined()
    })

    it('should remove examples field', () => {
      const input = {
        type: 'string',
        examples: ['foo', 'bar'],
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect((result as Record<string, unknown>).examples).toBeUndefined()
    })

    it('should remove title field', () => {
      const input = {
        type: 'object',
        title: 'MyObject',
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect((result as Record<string, unknown>).title).toBeUndefined()
    })

    it('should remove multiple disallowed fields at once', () => {
      const input = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'test',
        title: 'Test',
        default: 'value',
        examples: ['a', 'b'],
        type: 'string',
        description: 'kept',
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)
      const resultObj = result as Record<string, unknown>

      expect(resultObj.$schema).toBeUndefined()
      expect(resultObj.$id).toBeUndefined()
      expect(resultObj.title).toBeUndefined()
      expect(resultObj.default).toBeUndefined()
      expect(resultObj.examples).toBeUndefined()
      expect(result.type).toBe('string')
      expect(result.description).toBe('kept')
    })
  })

  describe('nested sanitization', () => {
    it('should sanitize nested properties', () => {
      const input = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            title: 'User object',
            default: {},
            properties: {
              name: { type: 'string', examples: ['John'] },
            },
          },
        },
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)
      const userProp = result.properties?.user as Record<string, unknown>
      const nameProp = result.properties?.user?.properties?.name as Record<string, unknown>

      expect(userProp.title).toBeUndefined()
      expect(userProp.default).toBeUndefined()
      expect(nameProp.examples).toBeUndefined()
      expect(result.properties?.user?.type).toBe('object')
    })

    it('should sanitize items in array schemas', () => {
      const input = {
        type: 'array',
        items: {
          type: 'object',
          title: 'ArrayItem',
          default: {},
          properties: {
            id: { type: 'number', examples: [1, 2, 3] },
          },
        },
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)
      const items = result.items as Record<string, unknown>

      expect(items.title).toBeUndefined()
      expect(items.default).toBeUndefined()
      expect((result.items?.properties?.id as Record<string, unknown>).examples).toBeUndefined()
    })

    it('should sanitize anyOf/oneOf/allOf schemas', () => {
      const input = {
        anyOf: [
          { type: 'string', title: 'StringOption', default: '' },
          { type: 'number', examples: [1, 2] },
        ],
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect((result.anyOf?.[0] as Record<string, unknown>).title).toBeUndefined()
      expect((result.anyOf?.[0] as Record<string, unknown>).default).toBeUndefined()
      expect((result.anyOf?.[1] as Record<string, unknown>).examples).toBeUndefined()
    })

    it('should sanitize additionalProperties when it is a schema', () => {
      const input = {
        type: 'object',
        additionalProperties: {
          type: 'string',
          title: 'ExtraProp',
          default: 'x',
        },
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)
      const addProps = result.additionalProperties as Record<string, unknown>

      expect(addProps.title).toBeUndefined()
      expect(addProps.default).toBeUndefined()
      expect((result.additionalProperties as JSONSchemaProperty).type).toBe('string')
    })
  })

  describe('edge cases', () => {
    it('should handle empty schema', () => {
      const input = {} as JSONSchemaProperty
      const result = sanitizeSchema(input)
      expect(result).toEqual({})
    })

    it('should handle null-ish values gracefully', () => {
      const input = {
        type: 'object',
        properties: undefined,
        required: undefined,
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)

      expect(result.type).toBe('object')
      expect(result.properties).toBeUndefined()
    })

    it('should preserve boolean additionalProperties', () => {
      const input: JSONSchemaProperty = {
        type: 'object',
        additionalProperties: true,
      }

      const result = sanitizeSchema(input)

      expect(result.additionalProperties).toBe(true)
    })

    it('should handle deeply nested schemas', () => {
      const input = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                title: 'DeepNested',
                properties: {
                  level3: { type: 'string', examples: ['deep'] },
                },
              },
            },
          },
        },
      } as JSONSchemaProperty

      const result = sanitizeSchema(input)
      const level2 = result.properties?.level1?.properties?.level2 as Record<string, unknown>
      const level3 = result.properties?.level1?.properties?.level2?.properties?.level3 as Record<
        string,
        unknown
      >

      expect(level2.title).toBeUndefined()
      expect(level3.examples).toBeUndefined()
    })
  })
})
