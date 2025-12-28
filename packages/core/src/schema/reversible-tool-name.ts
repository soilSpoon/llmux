/**
 * Reversible Tool Name Encoding/Decoding for Antigravity API
 *
 * Antigravity API has strict tool name requirements:
 * - Allowed: a-zA-Z0-9, underscores (_), dots (.), colons (:), dashes (-)
 * - First character must be letter or underscore
 * - Max length: 64 characters
 * - NOT allowed: slashes (/), spaces, other special characters
 *
 * This module provides reversible encoding to satisfy these constraints
 * while preserving the ability to recover original tool names in responses.
 */

// Encoding patterns: special char -> safe placeholder
const ENCODE_MAP: [RegExp, string][] = [
  [/\//g, '__slash__'],
  [/ /g, '__space__'],
]

// Decoding patterns: safe placeholder -> original char
const DECODE_MAP: [RegExp, string][] = [
  [/__slash__/g, '/'],
  [/__space__/g, ' '],
]

// Invalid first character pattern (not letter or underscore)
const INVALID_FIRST_CHAR = /^[^a-zA-Z_]/

// Max tool name length
const MAX_LENGTH = 64

/**
 * Encode a tool name for Antigravity API compliance.
 * Converts special characters to reversible placeholders.
 *
 * Examples:
 * - 'mcp/read_file' -> 'mcp__slash__read_file'
 * - 'my tool' -> 'my__space__tool'
 *
 * @param name - Original tool name (may contain slashes, spaces, etc.)
 * @returns Encoded name safe for Antigravity API
 */
export function encodeAntigravityToolName(name: string): string {
  if (!name || name.length === 0) {
    return '_tool'
  }

  let result = name

  // Apply encoding transformations
  for (const [pattern, replacement] of ENCODE_MAP) {
    result = result.replace(pattern, replacement)
  }

  // Ensure first character is valid (letter or underscore)
  if (INVALID_FIRST_CHAR.test(result)) {
    result = `_${result}`
  }

  // Truncate if exceeds max length
  if (result.length > MAX_LENGTH) {
    result = result.slice(0, MAX_LENGTH)
  }

  return result
}

/**
 * Decode an Antigravity API tool name back to its original form.
 * Restores special characters from placeholders.
 *
 * Examples:
 * - 'mcp__slash__read_file' -> 'mcp/read_file'
 * - 'my__space__tool' -> 'my tool'
 *
 * @param name - Encoded tool name from Antigravity API
 * @returns Original tool name with special characters restored
 */
export function decodeAntigravityToolName(name: string): string {
  if (!name || name.length === 0) {
    return ''
  }

  let result = name

  // Apply decoding transformations
  for (const [pattern, replacement] of DECODE_MAP) {
    result = result.replace(pattern, replacement)
  }

  return result
}
