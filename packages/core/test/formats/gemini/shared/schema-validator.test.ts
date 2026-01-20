import { describe, expect, it } from 'bun:test'
import { validateSanitizedSchema } from '../../../../src/formats/gemini/shared/schema-validator'
import type { JSONSchemaProperty } from '../../../../src/types/json-schema.js'

describe('SchemaValidator', () => {
  it('should pass for a correct schema', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }

    const result = validateSanitizedSchema(schema)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should fail if top-level type is not object', () => {
    const schema: JSONSchemaProperty = {
      type: 'string',
    }

    const result = validateSanitizedSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e: string) => e.includes('object'))).toBe(true)
  })

  it('should fail if properties is missing', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
    }

    const result = validateSanitizedSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e: string) => e.includes('property'))).toBe(true)
  })

  it('should fail if required key is not in properties', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['missing'],
    }

    const result = validateSanitizedSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e: string) => e.includes('missing'))).toBe(true)
  })

  it('should fail if unsupported keywords are present', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: { name: { type: 'string' } },
      $ref: '#/defs/bad',
    }

    const result = validateSanitizedSchema(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e: string) => e.includes('$ref'))).toBe(true)
  })
})
