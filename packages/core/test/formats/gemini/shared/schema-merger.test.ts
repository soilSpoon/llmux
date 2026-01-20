import { describe, expect, it } from 'bun:test'
import { mergeSchemaCombinators } from '../../../../src/formats/gemini/shared/schema-merger.js'
import type { JSONSchemaProperty } from '../../../../src/types/json-schema.js'

describe('SchemaMerger', () => {
  it('should merge allOf properties and union required', () => {
    const schema: JSONSchemaProperty = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    }

    const result = mergeSchemaCombinators(schema)
    expect(result.properties?.a).toBeDefined()
    expect(result.properties?.b).toBeDefined()
    expect(result.required).toContain('a')
    expect(result.required).toContain('b')
    expect(result.allOf).toBeUndefined()
  })

  it('should handle anyOf with conservative union', () => {
    const schema: JSONSchemaProperty = {
      anyOf: [
        { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
        { type: 'object', properties: { y: { type: 'number' } }, required: ['x', 'y'] },
      ],
    }

    const result = mergeSchemaCombinators(schema)
    expect(result.properties?.x).toBeDefined()
    expect(result.properties?.y).toBeDefined()
    // 교집합이므로 x만 required
    expect(result.required).toContain('x')
    expect(result.required).not.toContain('y')
    expect(result.anyOf).toBeUndefined()
  })

  it('should handle nested combinators', () => {
    const schema: JSONSchemaProperty = {
      type: 'object',
      properties: {
        nested: {
          allOf: [{ properties: { n: { type: 'string' } } }],
        },
      },
    }

    const result = mergeSchemaCombinators(schema)
    expect(result.properties?.nested?.properties?.n).toBeDefined()
    expect(result.properties?.nested?.allOf).toBeUndefined()
  })
})
