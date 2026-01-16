import { describe, expect, it } from 'bun:test'
import {
  camelToSnakeKey,
  snakeToCamelKey,
  convertKeysDeep,
} from '../../src/utils/casing'

describe('Casing Utilities', () => {
  describe('camelToSnakeKey', () => {
    it('should convert standard camelCase to snake_case', () => {
      expect(camelToSnakeKey('thinkingBudget')).toBe('thinking_budget')
      expect(camelToSnakeKey('includeThoughts')).toBe('include_thoughts')
      expect(camelToSnakeKey('userId')).toBe('user_id')
    })

    it('should handle consecutive uppercase letters (acronyms)', () => {
      expect(camelToSnakeKey('XMLParser')).toBe('xml_parser')
      expect(camelToSnakeKey('HTTPClientRequest')).toBe('http_client_request')
    })

    it('should handle single words (no change expected if lowercase)', () => {
      expect(camelToSnakeKey('model')).toBe('model')
    })

    it('should lowercase simple capitalized words', () => {
      // Though typically input is camelCase (lowercase first),
      // robustness for PascalCase is good if it happens.
      expect(camelToSnakeKey('Model')).toBe('model')
    })
  })

  describe('snakeToCamelKey', () => {
    it('should convert snake_case to camelCase', () => {
      expect(snakeToCamelKey('thinking_budget')).toBe('thinkingBudget')
      expect(snakeToCamelKey('include_thoughts')).toBe('includeThoughts')
      expect(snakeToCamelKey('user_id')).toBe('userId')
    })

    it('should handle multiple underscores', () => {
      expect(snakeToCamelKey('very_long_variable_name')).toBe('veryLongVariableName')
    })

    it('should handle single words (no change)', () => {
      expect(snakeToCamelKey('model')).toBe('model')
    })
  })

  describe('convertKeysDeep', () => {
    it('should convert nested object keys', () => {
      const input = {
        thinkingBudget: 1024,
        nestedConfig: {
          includeThoughts: true,
          maxTokens: 500,
        },
      }

      const result = convertKeysDeep(input, camelToSnakeKey) as unknown

      expect(result).toEqual({
        thinking_budget: 1024,
        nested_config: {
          include_thoughts: true,
          max_tokens: 500,
        },
      })
    })

    it('should convert objects inside arrays', () => {
      const input = {
        messages: [
          { roleType: 'user', contentData: 'hello' },
          { roleType: 'assistant', contentData: 'hi' },
        ],
      }

      const result = convertKeysDeep(input, camelToSnakeKey) as unknown

      expect(result).toEqual({
        messages: [
          { role_type: 'user', content_data: 'hello' },
          { role_type: 'assistant', content_data: 'hi' },
        ],
      })
    })

    it('should preserve null values', () => {
      const input = {
        thinkingConfig: null,
        otherValue: 'test',
      }

      const result = convertKeysDeep(input, camelToSnakeKey) as unknown

      expect(result).toEqual({
        thinking_config: null,
        other_value: 'test',
      })
    })

    it('should preserve undefined values', () => {
      const input = {
        thinkingConfig: undefined,
        otherValue: 'test',
      }

      const result = convertKeysDeep(input, camelToSnakeKey) as unknown

      expect(result).toEqual({
        thinking_config: undefined,
        other_value: 'test',
      })
    })

    it('should preserve primitive values unchanged', () => {
      expect(convertKeysDeep('string', camelToSnakeKey)).toBe('string')
      expect(convertKeysDeep(123, camelToSnakeKey)).toBe(123)
      expect(convertKeysDeep(true, camelToSnakeKey)).toBe(true)
      expect(convertKeysDeep(null, camelToSnakeKey)).toBe(null)
      expect(convertKeysDeep(undefined, camelToSnakeKey)).toBe(undefined)
    })

    it('should preserve specified keys with preserveKeys option', () => {
      const input = {
        thinkingBudget: 1024,
        metadata: { someKey: 'value' },
        content: 'hello',
      }

      const result = convertKeysDeep(input, camelToSnakeKey, {
        preserveKeys: ['metadata', 'content'],
      }) as unknown

      expect(result).toEqual({
        thinking_budget: 1024,
        metadata: { some_key: 'value' },
        content: 'hello',
      })
    })

    it('should work with snakeToCamelKey converter', () => {
      const input = {
        thinking_budget: 1024,
        nested_config: {
          include_thoughts: true,
        },
      }

      const result = convertKeysDeep(input, snakeToCamelKey) as unknown

      expect(result).toEqual({
        thinkingBudget: 1024,
        nestedConfig: {
          includeThoughts: true,
        },
      })
    })

    it('should handle deeply nested structures', () => {
      const input = {
        levelOne: {
          levelTwo: {
            levelThree: {
              deepValue: 'test',
            },
          },
        },
      }

      const result = convertKeysDeep(input, camelToSnakeKey) as unknown

      expect(result).toEqual({
        level_one: {
          level_two: {
            level_three: {
              deep_value: 'test',
            },
          },
        },
      })
    })

    it('should handle empty objects and arrays', () => {
      expect(convertKeysDeep({}, camelToSnakeKey)).toEqual({})
      expect(convertKeysDeep([], camelToSnakeKey)).toEqual([])
    })

    it('should handle mixed arrays with primitives and objects', () => {
      const input = {
        mixedArray: [1, 'string', { nestedKey: true }, null],
      }

      const result = convertKeysDeep(input, camelToSnakeKey) as unknown

      expect(result).toEqual({
        mixed_array: [1, 'string', { nested_key: true }, null],
      })
    })
  })
})
