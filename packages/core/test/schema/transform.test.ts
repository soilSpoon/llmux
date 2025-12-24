import { describe, expect, it } from 'bun:test'
import {
  constToEnum,
  inlineRefs,
  anyOfToSnakeCase,
  addEmptySchemaPlaceholder,
  transformSchema,
} from '../../src/schema/transform'
import type { JSONSchemaProperty } from '../../src/types/unified'

describe('constToEnum', () => {
  it('should convert const to enum with single value', () => {
    const input = { const: 'fixed_value' } as JSONSchemaProperty & { const?: unknown }
    const result = constToEnum(input)

    expect(result.enum).toEqual(['fixed_value'])
    expect((result as Record<string, unknown>).const).toBeUndefined()
  })

  it('should convert numeric const', () => {
    const input = { const: 42 } as JSONSchemaProperty & { const?: unknown }
    const result = constToEnum(input)

    expect(result.enum).toEqual([42])
  })

  it('should convert boolean const', () => {
    const input = { const: true } as JSONSchemaProperty & { const?: unknown }
    const result = constToEnum(input)

    expect(result.enum).toEqual([true])
  })

  it('should not modify schema without const', () => {
    const input: JSONSchemaProperty = { type: 'string' }
    const result = constToEnum(input)

    expect(result.enum).toBeUndefined()
    expect(result.type).toBe('string')
  })

  it('should preserve existing enum if no const', () => {
    const input: JSONSchemaProperty = { type: 'string', enum: ['a', 'b'] }
    const result = constToEnum(input)

    expect(result.enum).toEqual(['a', 'b'])
  })

  it('should convert const in nested properties', () => {
    const input = {
      type: 'object',
      properties: {
        status: { const: 'active' },
      },
    } as JSONSchemaProperty

    const result = constToEnum(input)

    expect(result.properties?.status?.enum).toEqual(['active'])
    expect((result.properties?.status as Record<string, unknown>).const).toBeUndefined()
  })
})

describe('inlineRefs', () => {
  it('should inline $ref from $defs', () => {
    const input = {
      $defs: {
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
          },
        },
      },
      type: 'object',
      properties: {
        home: { $ref: '#/$defs/Address' },
      },
    } as JSONSchemaProperty & { $defs?: Record<string, JSONSchemaProperty> }

    const result = inlineRefs(input)

    expect((result as Record<string, unknown>).$defs).toBeUndefined()
    expect((result.properties?.home as Record<string, unknown>).$ref).toBeUndefined()
    expect(result.properties?.home?.type).toBe('object')
    expect(result.properties?.home?.properties?.street?.type).toBe('string')
  })

  it('should inline multiple refs to same definition', () => {
    const input = {
      $defs: {
        Name: { type: 'string', description: 'A name' },
      },
      type: 'object',
      properties: {
        firstName: { $ref: '#/$defs/Name' },
        lastName: { $ref: '#/$defs/Name' },
      },
    } as JSONSchemaProperty & { $defs?: Record<string, JSONSchemaProperty> }

    const result = inlineRefs(input)

    expect(result.properties?.firstName?.type).toBe('string')
    expect(result.properties?.lastName?.type).toBe('string')
    expect(result.properties?.firstName?.description).toBe('A name')
  })

  it('should handle nested refs in definitions', () => {
    const input = {
      $defs: {
        Inner: { type: 'string' },
        Outer: {
          type: 'object',
          properties: {
            value: { $ref: '#/$defs/Inner' },
          },
        },
      },
      type: 'object',
      properties: {
        data: { $ref: '#/$defs/Outer' },
      },
    } as JSONSchemaProperty & { $defs?: Record<string, JSONSchemaProperty> }

    const result = inlineRefs(input)

    expect(result.properties?.data?.properties?.value?.type).toBe('string')
  })

  it('should handle refs in anyOf', () => {
    const input = {
      $defs: {
        StringType: { type: 'string' },
        NumberType: { type: 'number' },
      },
      anyOf: [{ $ref: '#/$defs/StringType' }, { $ref: '#/$defs/NumberType' }],
    } as JSONSchemaProperty & { $defs?: Record<string, JSONSchemaProperty> }

    const result = inlineRefs(input)

    expect(result.anyOf?.[0].type).toBe('string')
    expect(result.anyOf?.[1].type).toBe('number')
  })

  it('should handle schema without $defs or $ref', () => {
    const input: JSONSchemaProperty = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    const result = inlineRefs(input)

    expect(result.type).toBe('object')
    expect(result.properties?.name?.type).toBe('string')
  })

  it('should support definitions alias for $defs', () => {
    const input = {
      definitions: {
        Email: { type: 'string', description: 'Email address' },
      },
      type: 'object',
      properties: {
        email: { $ref: '#/definitions/Email' },
      },
    } as JSONSchemaProperty & { definitions?: Record<string, JSONSchemaProperty> }

    const result = inlineRefs(input)

    expect((result as Record<string, unknown>).definitions).toBeUndefined()
    expect(result.properties?.email?.type).toBe('string')
  })
})

describe('anyOfToSnakeCase', () => {
  it('should convert anyOf to any_of for Gemini compatibility', () => {
    const input: JSONSchemaProperty = {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    }

    const result = anyOfToSnakeCase(input)
    const resultObj = result as Record<string, unknown>

    expect(resultObj.any_of).toEqual([{ type: 'string' }, { type: 'null' }])
    expect(result.anyOf).toBeUndefined()
  })

  it('should convert nested anyOf', () => {
    const input: JSONSchemaProperty = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    }

    const result = anyOfToSnakeCase(input)
    const valueProp = result.properties?.value as Record<string, unknown>

    expect(valueProp.any_of).toBeDefined()
    expect((result.properties?.value as JSONSchemaProperty).anyOf).toBeUndefined()
  })

  it('should not affect schema without anyOf', () => {
    const input: JSONSchemaProperty = {
      type: 'string',
      enum: ['a', 'b'],
    }

    const result = anyOfToSnakeCase(input)

    expect(result.type).toBe('string')
    expect(result.enum).toEqual(['a', 'b'])
    expect((result as Record<string, unknown>).any_of).toBeUndefined()
  })
})

describe('addEmptySchemaPlaceholder', () => {
  it('should add type:object to empty schema', () => {
    const input = {} as JSONSchemaProperty

    const result = addEmptySchemaPlaceholder(input)

    expect(result.type).toBe('object')
  })

  it('should not modify schema with existing type', () => {
    const input: JSONSchemaProperty = { type: 'string' }

    const result = addEmptySchemaPlaceholder(input)

    expect(result.type).toBe('string')
  })

  it('should add type to empty nested schemas', () => {
    const input: JSONSchemaProperty = {
      type: 'object',
      properties: {
        data: {},
      },
    }

    const result = addEmptySchemaPlaceholder(input)

    expect(result.properties?.data?.type).toBe('object')
  })

  it('should handle anyOf with empty schema', () => {
    const input: JSONSchemaProperty = {
      anyOf: [{}, { type: 'string' }],
    }

    const result = addEmptySchemaPlaceholder(input)

    expect(result.anyOf?.[0].type).toBe('object')
    expect(result.anyOf?.[1].type).toBe('string')
  })
})

describe('transformSchema', () => {
  it('should apply all transformations', () => {
    const input = {
      $defs: {
        Status: { const: 'active' },
      },
      type: 'object',
      title: 'MySchema',
      properties: {
        status: { $ref: '#/$defs/Status' },
        value: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        empty: {},
      },
    } as JSONSchemaProperty & { $defs?: Record<string, JSONSchemaProperty> }

    const result = transformSchema(input)
    const resultObj = result as Record<string, unknown>

    expect(resultObj.$defs).toBeUndefined()
    expect(resultObj.title).toBeUndefined()
    expect(result.properties?.status?.enum).toEqual(['active'])
    expect((result.properties?.value as Record<string, unknown>).any_of).toBeDefined()
    expect(result.properties?.empty?.type).toBe('object')
  })

  it('should handle complex nested transformations', () => {
    const input = {
      $defs: {
        Item: {
          type: 'object',
          default: {},
          properties: {
            type: { const: 'item' },
            data: {
              anyOf: [{ type: 'string' }, { $ref: '#/$defs/NestedData' }],
            },
          },
        },
        NestedData: {
          type: 'object',
          title: 'NestedData',
          properties: {
            value: { type: 'number', examples: [1, 2, 3] },
          },
        },
      },
      type: 'array',
      items: { $ref: '#/$defs/Item' },
    } as JSONSchemaProperty & { $defs?: Record<string, JSONSchemaProperty> }

    const result = transformSchema(input)
    const items = result.items as Record<string, unknown>

    expect(items.default).toBeUndefined()
    expect(result.items?.properties?.type?.enum).toEqual(['item'])
    expect((result.items?.properties?.data as Record<string, unknown>).any_of).toBeDefined()
  })
})
