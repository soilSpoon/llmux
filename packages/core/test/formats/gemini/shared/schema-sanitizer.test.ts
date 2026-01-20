import { describe, expect, it } from 'bun:test'
import { cleanSchemaForAntigravity } from '../../../../src/formats/gemini/shared/schema-sanitizer'
import type { JSONSchemaProperty } from '../../../../src/types/json-schema.js'

describe('SchemaSanitizer', () => {
  it('should drop unsupported fields and keep them as hints in description', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          title: 'User Name',
          default: 'test',
        },
      },
    }

    const result = cleanSchemaForAntigravity(schema)
    const nameProp = result.properties?.name
    expect(nameProp).toBeDefined()
    if (nameProp) {
      // GeminiSchema에는 title, default가 없음 (description에 힌트로 포함됨)
      expect(nameProp.description).toContain('Title')
      expect(nameProp.description).toContain('Default')
    }
  })

  it('should convert const to enum', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'fixed_value',
        },
      },
    }

    const result = cleanSchemaForAntigravity(schema)
    const typeProp = result.properties?.type
    expect(typeProp).toBeDefined()
    if (typeProp) {
      expect(typeProp.enum).toEqual(['fixed_value'])
    }
  })

  it('should handle full pipeline ($ref -> allOf -> clean)', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: {
        user: { $ref: '#/$defs/User' },
      },
      $defs: {
        User: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    }

    const result = cleanSchemaForAntigravity(schema)
    const userProp = result.properties?.user
    expect(userProp).toBeDefined()
    if (userProp) {
      // GeminiSchema로 변환됨, type은 대문자
      expect(userProp.type).toBe('OBJECT')
    }
  })

  it('should add placeholder for empty object schemas', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: {},
    }

    const result = cleanSchemaForAntigravity(schema)
    expect(result.properties?._placeholder).toBeDefined()
  })
})
