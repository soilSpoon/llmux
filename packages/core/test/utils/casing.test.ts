import { describe, expect, it } from 'bun:test'
import { camelToSnakeKey, snakeToCamelKey } from '../../src/utils/casing'

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
})
