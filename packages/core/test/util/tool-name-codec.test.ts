import { describe, expect, it } from 'bun:test'
import { ToolNameCodec } from '../../src/util/tool-name-codec'

describe('ToolNameCodec', () => {
  const codec = new ToolNameCodec()

  it('should encode normal names with "t" prefix and base64url', () => {
    const original = 'my-function_name'
    const encoded = codec.encode(original)

    expect(encoded).toMatch(/^t[a-zA-Z0-9_-]+$/)
    expect(codec.decode(encoded)).toBe(original)
  })

  it('should handle special characters correctly', () => {
    const original = 'mcp/filesystem/read_file'
    const encoded = codec.encode(original)

    expect(encoded).not.toContain('/')
    expect(codec.decode(encoded)).toBe(original)
  })

  it('should encode long names with "h" prefix and hash', () => {
    const longName = 'this_is_a_very_long_function_name_that_exceeds_the_sixty_four_character_limit_of_gemini_api'
    const encoded = codec.encode(longName)

    expect(encoded.length).toBeLessThanOrEqual(64)
    expect(encoded.startsWith('h')).toBe(true)
    expect(codec.decode(encoded)).toBe(longName)
  })

  it('should be deterministic', () => {
    const original = 'repeat_test'
    expect(codec.encode(original)).toBe(codec.encode(original))
  })

  it('should return encoded string as is if prefix is missing (decoding fallback)', () => {
    const raw = 'legacy_function_name'
    expect(codec.decode(raw)).toBe(raw)
  })

  it('should return unknown_tool_{hash} if hash is not in registry', () => {
    const tempCodec = new ToolNameCodec()
    const longName = 'ephemeral_tool_with_very_long_name_exceeding_sixty_four_chars_limit_to_trigger_hash_lookup_logic'
    const encoded = tempCodec.encode(longName)
    
    const newCodec = new ToolNameCodec()
    expect(newCodec.decode(encoded)).toMatch(/^unknown_tool_/)
  })
})
