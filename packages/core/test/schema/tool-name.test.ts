import { describe, expect, it } from 'bun:test'
import { sanitizeToolName } from '../../src/schema/tool-name'

describe('sanitizeToolName', () => {
  describe('character rules', () => {
    it('should keep valid characters: a-z, A-Z, 0-9, _, ., -, :', () => {
      expect(sanitizeToolName('valid_name')).toBe('valid_name')
      expect(sanitizeToolName('Tool.Name')).toBe('Tool.Name')
      expect(sanitizeToolName('tool-name')).toBe('tool-name')
      expect(sanitizeToolName('tool:action')).toBe('tool:action')
      expect(sanitizeToolName('Tool123')).toBe('Tool123')
    })

    it('should replace spaces with underscores', () => {
      expect(sanitizeToolName('my tool name')).toBe('my_tool_name')
    })

    it('should replace slashes with underscores', () => {
      expect(sanitizeToolName('path/to/tool')).toBe('path_to_tool')
    })

    it('should remove other special characters', () => {
      expect(sanitizeToolName('tool@name!')).toBe('toolname')
      expect(sanitizeToolName('func(arg)')).toBe('funcarg')
      expect(sanitizeToolName('item[0]')).toBe('item0')
      expect(sanitizeToolName('key=value')).toBe('keyvalue')
      expect(sanitizeToolName('a&b|c')).toBe('abc')
    })

    it('should handle multiple consecutive special chars', () => {
      expect(sanitizeToolName('a  b')).toBe('a_b')
      expect(sanitizeToolName('a//b')).toBe('a_b')
      expect(sanitizeToolName('a / b')).toBe('a_b')
    })
  })

  describe('first character rules', () => {
    it('should prepend underscore if first char is a digit', () => {
      expect(sanitizeToolName('123tool')).toBe('_123tool')
      expect(sanitizeToolName('0_start')).toBe('_0_start')
    })

    it('should prepend underscore if first char is a dash', () => {
      expect(sanitizeToolName('-tool')).toBe('_-tool')
    })

    it('should prepend underscore if first char is a dot', () => {
      expect(sanitizeToolName('.hidden')).toBe('_.hidden')
    })

    it('should prepend underscore if first char is a colon', () => {
      expect(sanitizeToolName(':action')).toBe('_:action')
    })

    it('should not modify if first char is letter or underscore', () => {
      expect(sanitizeToolName('Tool')).toBe('Tool')
      expect(sanitizeToolName('_private')).toBe('_private')
    })
  })

  describe('length limit', () => {
    it('should truncate names longer than 64 characters', () => {
      const longName = 'a'.repeat(100)
      const result = sanitizeToolName(longName)
      expect(result.length).toBe(64)
      expect(result).toBe('a'.repeat(64))
    })

    it('should not modify names at exactly 64 characters', () => {
      const name64 = 'a'.repeat(64)
      expect(sanitizeToolName(name64)).toBe(name64)
    })

    it('should not modify names shorter than 64 characters', () => {
      const shortName = 'my_tool'
      expect(sanitizeToolName(shortName)).toBe(shortName)
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(sanitizeToolName('')).toBe('_tool')
    })

    it('should handle string with only special chars', () => {
      expect(sanitizeToolName('@#$%')).toBe('_tool')
    })

    it('should handle whitespace only', () => {
      expect(sanitizeToolName('   ')).toBe('_tool')
    })

    it('should handle unicode characters', () => {
      expect(sanitizeToolName('도구_tool')).toBe('_tool')
      expect(sanitizeToolName('tool_日本語')).toBe('tool')
    })

    it('should collapse multiple underscores after sanitization', () => {
      expect(sanitizeToolName('a  /  b')).toBe('a_b')
      expect(sanitizeToolName('path///to///tool')).toBe('path_to_tool')
    })
  })

  describe('real-world examples', () => {
    it('should sanitize common tool name patterns', () => {
      expect(sanitizeToolName('mcp__server__tool')).toBe('mcp__server__tool')
      expect(sanitizeToolName('Read File')).toBe('Read_File')
      expect(sanitizeToolName('git/commit')).toBe('git_commit')
      expect(sanitizeToolName('api.v2.endpoint')).toBe('api.v2.endpoint')
    })

    it('should handle Gemini-incompatible patterns from OpenAI/Anthropic', () => {
      expect(sanitizeToolName('function(params)')).toBe('functionparams')
      expect(sanitizeToolName('tool[0].action')).toBe('tool0.action')
      expect(sanitizeToolName('namespace::tool')).toBe('namespace::tool')
    })
  })
})
