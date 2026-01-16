
import { describe, expect, it } from 'bun:test'
import { convertToWireFormat, preprocessTools } from '../../../src/providers/antigravity/transform-utils'
import type { UnifiedTool } from '../../../src/types/unified'

describe('convertToWireFormat', () => {
  it('should preserve camelCase keys in tool parameters while converting others to snake_case', () => {
    const input = {
      systemInstruction: {
        parts: [{ text: 'You are a bot.' }],
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'my_tool',
              description: 'My tool',
              parameters: {
                type: 'object',
                properties: {
                  myParam: { type: 'string' },
                  nestedObject: {
                    type: 'object',
                    properties: {
                      deepKey: { type: 'string' }
                    },
                    required: ['deepKey']
                  }
                },
                required: ['myParam']
              }
            }
          ]
        }
      ]
    }

    const result = convertToWireFormat(input as any)

    // Check snake_case conversion for protocol fields
    expect(result).toHaveProperty('system_instruction')
    expect(result).not.toHaveProperty('systemInstruction')
    expect(result).toHaveProperty('tools')

    // Check tool parameters preservation
    const tool = (result as any).tools[0].function_declarations[0]
    const props = tool.parameters.properties

    // Top-level parameter key should be preserved
    expect(props).toHaveProperty('myParam')
    expect(props).not.toHaveProperty('my_param')

    // Nested parameter key should be preserved
    expect(props.nestedObject.properties).toHaveProperty('deepKey')
    expect(props.nestedObject.properties).not.toHaveProperty('deep_key')
    
    // Required arrays should still match the keys
    expect(tool.parameters.required).toContain('myParam')
    expect(props.nestedObject.required).toContain('deepKey')
  })
})

describe('preprocessTools', () => {
  it('should flatten custom.input_schema wrapper', () => {
    const input: UnifiedTool[] = [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            custom: {
              type: 'object',
              properties: {
                input_schema: {
                  type: 'object',
                  properties: {
                    arg1: { type: 'string' },
                  },
                  required: ['arg1'],
                },
              },
            },
          },
        },
      },
      {
        name: 'normal_tool',
        description: 'A normal tool',
        parameters: {
          type: 'object',
          properties: {
            arg1: { type: 'string' },
          },
        },
      },
    ]

    const result = preprocessTools(input)
    expect(result).toBeDefined()
    if (!result) return

    expect(result).toHaveLength(2)

    // Check flattened tool
    expect(result[0]!.parameters).toEqual({
      type: 'object',
      properties: {
        arg1: { type: 'string' },
      },
      required: ['arg1'],
    })

    // Check flattened tool sanitization - 'custom' should not exist on the result
    expect(Object.hasOwn(result[0] ?? {}, 'custom')).toBe(false)

    // Check normal tool remains unchanged
    expect(result[1]!.parameters).toEqual({
      type: 'object',
      properties: {
        arg1: { type: 'string' },
      },
    })
  })

  it('should return undefined if input is undefined', () => {
    expect(preprocessTools(undefined)).toBeUndefined()
  })

  it('should handle tools without parameters', () => {
    const input: UnifiedTool[] = [
      {
        name: 'no_params_tool',
        description: 'Tool without params',
        parameters: { type: 'object', properties: {} },
      },
    ]
    const result = preprocessTools(input)
    expect(result).toBeDefined()
    if (!result) return

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(input[0])
  })

  it('should encode tool names', () => {
    const input: UnifiedTool[] = [
      {
        name: 'mcp/read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'my tool',
        description: 'Tool with space',
        parameters: { type: 'object', properties: {} },
      },
    ]

    const result = preprocessTools(input)
    expect(result).toBeDefined()
    if (!result) return

    expect(result).toHaveLength(2)
    expect(result[0]!.name).toBe('mcp__slash__read_file')
    expect(result[1]!.name).toBe('my__space__tool')
  })
})
