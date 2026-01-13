import { describe, expect, it } from 'bun:test'
import {
  parseTool,
  transformTool,
  transformToolChoice,
} from '../../../src/formats/openai-chat/tools'
import type { OpenAIChatFunctionParameters, OpenAIChatTool } from '../../../src/formats/openai-chat/types'
import type { JSONSchema, UnifiedTool } from '../../../src/types/unified'

describe('OpenAI Chat Tools', () => {
  describe('parseTool', () => {
    it('parses standard OpenAI tool format', () => {
      const tool: OpenAIChatTool = {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather info',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
          },
        },
      }

      const result = parseTool(tool)

      expect(result.name).toBe('get_weather')
      expect(result.description).toBe('Get weather info')
      // Safe assertion since structure matches
      expect(result.parameters).toEqual(tool.function.parameters as JSONSchema)
    })

    it('parses flattened format (Oracle style)', () => {
      // Define a type for the flattened tool format used in tests
      type FlattenedTool = {
        type: 'function'
        name: 'get_weather'
        description: 'Get weather info'
        parameters: {
          type: 'object'
          properties: {
            location: { type: 'string' }
          }
        }
      }

      const tool: FlattenedTool = {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather info',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
        },
      }

      // Cast to unknown first, then OpenAIChatTool to simulate incoming unknown data
      const result = parseTool(tool as unknown as OpenAIChatTool)

      expect(result.name).toBe('get_weather')
      expect(result.description).toBe('Get weather info')
      expect(result.parameters).toEqual(tool.parameters as unknown as JSONSchema)
    })

    it('parses Anthropic-style flattened tool', () => {
      type AnthropicTool = {
        type: 'tool'
        name: 'get_weather'
        description: 'Get weather info'
        input_schema: {
          type: 'object'
          properties: {
            location: { type: 'string' }
          }
        }
      }

      const tool: AnthropicTool = {
        type: 'tool',
        name: 'get_weather',
        description: 'Get weather info',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
        },
      }

      // Cast to unknown first, then OpenAIChatTool to simulate incoming unknown data
      const result = parseTool(tool as unknown as OpenAIChatTool)

      expect(result.name).toBe('get_weather')
      expect(result.description).toBe('Get weather info')
      expect(result.parameters).toEqual(tool.input_schema as unknown as JSONSchema)
    })

    it('throws error for invalid tool format', () => {
      const tool = {
        type: 'function',
      } as OpenAIChatTool

      expect(() => parseTool(tool)).toThrow('Tool must have a function definition')
    })
  })

  describe('transformTool', () => {
    it('transforms UnifiedTool to OpenAI format', () => {
      const tool: UnifiedTool = {
        name: 'get_weather',
        description: 'Get weather info',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
        },
      }

      const result = transformTool(tool)

      expect(result.type).toBe('function')
      expect(result.function.name).toBe('get_weather')
      expect(result.function.description).toBe('Get weather info')
      // Verify parameters structure matches
      expect(result.function.parameters).toEqual(tool.parameters as unknown as OpenAIChatFunctionParameters)
    })

    it('ensures parameters has type object', () => {
      // Create a tool with parameters missing 'type: object' but satisfying JSONSchema
      const parameters: JSONSchema = {
        properties: { foo: { type: 'string' } },
      } as unknown as JSONSchema

      // Force type to be object for the test purpose logic in transformTool
      // But here we want to test that transformTool ADDS type: object if missing
      // Let's create a minimal valid UnifiedTool
      const tool: UnifiedTool = {
        name: 'test',
        parameters,
      }

      const result = transformTool(tool)

      // Ensure parameters is not undefined
      if (!result.function.parameters) {
        throw new Error('Parameters should be defined')
      }

      expect(result.function.parameters.type).toBe('object')
    })
  })

  describe('transformToolChoice', () => {
    it('transforms string choices', () => {
      expect(transformToolChoice('auto')).toBe('auto')
      expect(transformToolChoice('none')).toBe('none')
      expect(transformToolChoice('required')).toBe('required')
    })

    it('transforms specific tool choice', () => {
      const result = transformToolChoice({
        type: 'tool',
        name: 'get_weather',
      })

      expect(result).toEqual({
        type: 'function',
        function: { name: 'get_weather' },
      })
    })

    it('returns undefined for undefined input', () => {
      expect(transformToolChoice(undefined)).toBeUndefined()
    })

    it('returns undefined for invalid string input', () => {
      // @ts-expect-error - testing invalid input
      expect(transformToolChoice('invalid')).toBeUndefined()
    })
  })
})
