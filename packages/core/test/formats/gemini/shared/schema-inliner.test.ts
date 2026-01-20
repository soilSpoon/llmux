import { describe, expect, it } from 'bun:test'
import { inlineSchemaRefs } from '../../../../src/formats/gemini/shared/schema-inliner.js'
import type { JSONSchemaProperty } from '../../../../src/types/json-schema.js'

describe('SchemaInliner', () => {
  it('should inline simple refs', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: {
        user: { $ref: '#/$defs/User' },
      },
      $defs: {
        User: { type: 'object', properties: { name: { type: 'string' } } },
      },
    }

    const result = inlineSchemaRefs(schema)
    const userProp = result.properties?.user
    expect(userProp).toBeDefined()
    if (userProp) {
      expect(userProp.$ref).toBeUndefined()
      expect(userProp.type).toBe('object')
      expect(userProp.properties?.name).toBeDefined()
    }
    expect(result.$defs).toBeUndefined()
  })

  it('should inline nested refs', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/A' } },
      $defs: {
        A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } },
        B: { type: 'string' },
      },
    }

    const result = inlineSchemaRefs(schema)
    expect(result.properties?.a?.properties?.b?.type).toBe('string')
  })

  it('should handle cyclic refs with a fallback', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { self: { $ref: '#/$defs/Self' } },
      $defs: {
        Self: { type: 'object', properties: { self: { $ref: '#/$defs/Self' } } },
      },
    }

    const result = inlineSchemaRefs(schema)

    // 첫 번째 self는 Self로 인라인됨
    const selfProp = result.properties?.self
    expect(selfProp).toBeDefined()
    expect(selfProp?.type).toBe('object')

    // 중첩된 self.properties.self가 cyclic으로 처리됨
    const nestedSelf = selfProp?.properties?.self
    expect(nestedSelf).toBeDefined()
    if (nestedSelf?.description) {
      expect(nestedSelf.description.includes('Cyclic')).toBe(true)
    }
  })

  it('should handle definitions key as well', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { item: { $ref: '#/definitions/Item' } },
      definitions: {
        Item: { type: 'number' },
      },
    }

    const result = inlineSchemaRefs(schema)
    expect(result.properties?.item?.type).toBe('number')
    expect(result.definitions).toBeUndefined()
  })
})
