/**
 * JSON argument parsing for tool responses
 * Handles cases where Gemini/Claude return JSON-stringified tool arguments
 */

/**
 * Recursively parse JSON-stringified values
 * Handles nested stringification and preserves non-JSON strings
 */
export function recursivelyParseJsonStrings(value: unknown): unknown {
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
