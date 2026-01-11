
import { describe, expect, it } from 'bun:test'
import { preprocessTools } from '../../../src/providers/antigravity/transform-utils'
import type { UnifiedTool } from '../../../src/types/unified'

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

    // Check flattened tool sanitization
    // biome-ignore lint/suspicious/noExplicitAny: testing for private property access
    expect((result[0] as any).custom).toBeUndefined()

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
})
