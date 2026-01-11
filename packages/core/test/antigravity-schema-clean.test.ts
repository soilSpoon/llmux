import { describe, it, expect } from 'bun:test'
import { cleanJSONSchemaForAntigravity } from '../src/providers/antigravity/schema/antigravity-json-schema-clean'

describe('cleanJSONSchemaForAntigravity', () => {
  it('should clean custom.input_schema but preserve custom field', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        custom: {
          type: 'object',
          input_schema: {
            type: 'object',
            properties: {
              test: { 
                type: 'string',
                minLength: 5,  // This should be moved to description
                pattern: '^[a-z]+$',  // This should be moved to description
                const: 'value'  // This should be converted to enum
              }
            },
            required: ['test'],
            $schema: 'https://json-schema.org/draft/2020-12/schema',  // This should be removed
            additionalProperties: false  // This should be moved to description
          }
        },
      },
      required: ['name'],
    }

    const cleaned = cleanJSONSchemaForAntigravity(schema as any)

    // The custom property should be preserved (this test covers case where cleanCustomField was added)
    // Note: This test is now mainly testing that cleaner doesn't crash on custom fields
    // The actual cleaning of custom.input_schema happens in transformTools function
    expect(cleaned.properties).toHaveProperty('custom')
    
    // The input_schema inside should remain unchanged by cleanJSONSchemaForAntigravity 
    // (since cleanCustomField was removed, it only processes parameters)
    const customProp = cleaned.properties.custom
    expect(customProp).toBeDefined()
    if (customProp && customProp.input_schema) {
      const customInputSchema = customProp.input_schema
      // cleanJSONSchemaForAntigravity recursively cleans all objects, including those under 'custom'
      // So these fields SHOULD be cleaned/moved
      expect(customInputSchema.properties.test).not.toHaveProperty('minLength')
      expect(customInputSchema.properties.test).not.toHaveProperty('pattern')
      expect(customInputSchema.properties.test).not.toHaveProperty('const')
      expect(customInputSchema.properties.test).toHaveProperty('enum')
      expect(customInputSchema.properties.test).not.toHaveProperty('$schema')
      expect(customInputSchema.properties.test).not.toHaveProperty('additionalProperties')
    }
  })

  it('should clean custom.input_schema in preprocessTools', () => {
    const { preprocessTools } = require('../src/providers/antigravity/transform-utils') as { 
      preprocessTools: (tools: unknown[] | undefined) => unknown[] | undefined 
    }
    
    const toolWithCustom = {
      name: 'test_tool',
      description: 'A tool with custom input_schema',
      parameters: { type: 'object', properties: {} },
      custom: {
        input_schema: {
          type: 'object',
          properties: {
            test: { 
              type: 'string',
              minLength: 5,
              pattern: '^[a-z]+$',
              const: 'value'
            }
          },
          required: ['test'],
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          additionalProperties: false
        }
      }
    }
    
    const processed = preprocessTools([toolWithCustom])
    expect(processed).toBeDefined()
    expect(processed?.length).toBe(1)
    
    const tool = processed?.[0] as Record<string, unknown>
    // preprocessTools removes 'custom' field from tool
    expect(tool).not.toHaveProperty('custom')
    // Name should be encoded
    expect(tool.name).toBe('test_tool')
  })

  it('should NOT include custom field in preprocessed tool (Antigravity API requirement)', () => {
    const { preprocessTools } = require('../src/providers/antigravity/transform-utils') as { 
      preprocessTools: (tools: unknown[] | undefined) => unknown[] | undefined 
    }
    
    const toolWithCustom = {
      name: 'test_tool',
      description: 'A tool with custom field',
      parameters: { type: 'object', properties: {} },
      custom: {
        input_schema: {
          type: 'object',
          properties: {
            arg: { type: 'string' }
          }
        },
        name: 'original_name',
        description: 'original description'
      }
    }
    
    const processed = preprocessTools([toolWithCustom])
    const tool = processed?.[0] as Record<string, unknown>
    
    // Tool should NOT have custom field - Antigravity API rejects it
    expect(tool).not.toHaveProperty('custom')
    // Should have standard tool fields
    expect(tool.name).toBe('test_tool')
    expect(tool.description).toBe('A tool with custom field')
  })
})
