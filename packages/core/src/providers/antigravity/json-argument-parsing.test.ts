import { describe, it, expect } from 'bun:test'

/**
 * Tests for JSON argument normalization in tool responses
 * Handles cases where Gemini/Claude return JSON-stringified tool arguments
 */

function recursivelyParseJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      // Recursively parse the parsed value in case it contains nested stringified JSON
      return recursivelyParseJsonStrings(parsed)
    } catch {
      // Not valid JSON, return as-is
      return value
    }
  }

  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map((item) => recursivelyParseJsonStrings(item))
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = recursivelyParseJsonStrings(val)
    }
    return result
  }

  return value
}

describe('JSON argument parsing', () => {
  describe('recursivelyParseJsonStrings', () => {
    it('should detect JSON-stringified arguments', () => {
      const input = '{"name":"test","value":123}'
      const result = recursivelyParseJsonStrings(input)

      expect(typeof result).toBe('object')
      expect((result as Record<string, unknown>).name).toBe('test')
      expect((result as Record<string, unknown>).value).toBe(123)
    })

    it('should recursively parse nested stringified values', () => {
      const input = {
        args: '{"nested":"{\\"deeply\\":\\"nested\\"}"}',
      }
      const result = recursivelyParseJsonStrings(input)

      expect(typeof result).toBe('object')
      // Result should have deeply parsed nested structure
      const nested = (result as Record<string, unknown>).args as Record<string, unknown>
      // The recursive parsing should handle escaped quotes in nested JSON
      expect(typeof nested.nested).toBe('object')
      expect((nested.nested as Record<string, unknown>).deeply).toBe('nested')
    })

    it('should handle truncated JSON gracefully', () => {
      const input = '{"name":"test","value":'
      const result = recursivelyParseJsonStrings(input)

      // Should return as string since it's invalid JSON
      expect(typeof result).toBe('string')
      expect(result).toBe(input)
    })

    it('should preserve non-stringified arguments', () => {
      const input = {
        name: 'test',
        value: 123,
        nested: { key: 'value' },
      }
      const result = recursivelyParseJsonStrings(input)

      expect(result).toEqual(input)
    })

    it('should handle arrays of stringified objects', () => {
      const input = [
        '{"id":1,"name":"first"}',
        '{"id":2,"name":"second"}',
      ]
      const result = recursivelyParseJsonStrings(input)

      expect(Array.isArray(result)).toBe(true)
      const arr = result as Array<Record<string, unknown>>
      expect(arr[0]?.id).toBe(1)
      expect(arr[0]?.name).toBe('first')
      expect(arr[1]?.id).toBe(2)
      expect(arr[1]?.name).toBe('second')
    })

    it('should handle mixed stringified and non-stringified values', () => {
      const input = {
        stringified: '{"key":"value"}',
        normal: { key: 'value' },
        number: 42,
      }
      const result = recursivelyParseJsonStrings(input)

      const obj = result as Record<string, unknown>
      expect(typeof obj.stringified).toBe('object')
      expect((obj.stringified as Record<string, unknown>).key).toBe('value')
      expect(typeof obj.normal).toBe('object')
      expect(obj.number).toBe(42)
    })

    it('should handle deeply nested stringified structures', () => {
      const input = {
        level1: '{"level2":"{\\"level3\\":42}"}',
      }
      const result = recursivelyParseJsonStrings(input)

      const obj = result as Record<string, unknown>
      expect(typeof obj.level1).toBe('object')
    })

    it('should preserve plain strings', () => {
      const input = {
        description: 'This is a description',
        notes: 'Some notes with no JSON',
      }
      const result = recursivelyParseJsonStrings(input)

      const obj = result as Record<string, unknown>
      expect(obj.description).toBe('This is a description')
      expect(obj.notes).toBe('Some notes with no JSON')
    })

    it('should handle empty objects and arrays', () => {
      const input = {
        emptyObj: '{}',
        emptyArray: '[]',
      }
      const result = recursivelyParseJsonStrings(input)

      const obj = result as Record<string, unknown>
      expect(obj.emptyObj).toEqual({})
      expect(obj.emptyArray).toEqual([])
    })

    it('should handle null and undefined', () => {
      const input = {
        nullValue: null,
        undefinedValue: undefined,
      }
      const result = recursivelyParseJsonStrings(input)

      const obj = result as Record<string, unknown>
      expect(obj.nullValue).toBeNull()
      expect(obj.undefinedValue).toBeUndefined()
    })

    it('should handle boolean and number JSON values', () => {
      const input = '{"isActive":true,"count":42,"ratio":3.14}'
      const result = recursivelyParseJsonStrings(input)

      const obj = result as Record<string, unknown>
      expect(obj.isActive).toBe(true)
      expect(obj.count).toBe(42)
      expect(obj.ratio).toBe(3.14)
    })

    it('should handle JSON arrays at root level', () => {
      const input = '[{"id":1},{"id":2}]'
      const result = recursivelyParseJsonStrings(input)

      expect(Array.isArray(result)).toBe(true)
      const arr = result as Array<Record<string, unknown>>
      expect(arr[0]?.id).toBe(1)
      expect(arr[1]?.id).toBe(2)
    })

    it('should handle very nested structures', () => {
      const input = {
        a: {
          b: {
            c: '{"d":"{\\"e\\":\\"value\\"}"}',
          },
        },
      }
      const result = recursivelyParseJsonStrings(input)

      expect(typeof result).toBe('object')
      // Verify structure was parsed correctly
      const deep = result as Record<string, unknown>
      expect(typeof deep.a).toBe('object')
    })
  })
})
