/**
 * Casing Utilities
 *
 * Reusable functions for converting between camelCase and snake_case keys.
 */

/**
 * Function type for key conversion.
 */
export type KeyConverter = (key: string) => string

/**
 * Options for deep key conversion.
 */
export interface ConvertKeysDeepOptions {
  /**
   * Keys to exclude from conversion. These keys will be preserved as-is.
   * Recursion continues into the value.
   */
  preserveKeys?: readonly string[]

  /**
   * Keys where conversion AND recursion should stop.
   * The value is copied as-is.
   */
  preserveTree?: readonly string[]
}

/**
 * Converts a camelCase string to snake_case.
 * Handles single uppercase letters and consecutive uppercase sequences correctly.
 *
 * Examples:
 * - "thinkingBudget" -> "thinking_budget"
 * - "includeThoughts" -> "include_thoughts"
 * - "XMLParser" -> "xml_parser"
 * - "userID" -> "user_id"
 */
export function camelToSnakeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase -> snake_case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2') // ACRONYMWord -> acronym_word
    .toLowerCase()
}

/**
 * Converts a snake_case string to camelCase.
 *
 * Examples:
 * - "thinking_budget" -> "thinkingBudget"
 * - "include_thoughts" -> "includeThoughts"
 * - "xml_parser" -> "xmlParser"
 * - "user_id" -> "userId"
 */
export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
}

/**
 * Recursively converts all keys in an object or array using the provided converter function.
 * Preserves null, undefined, and primitive values unchanged.
 *
 * @param value - The value to convert (object, array, or primitive)
 * @param converter - Function to convert each key
 * @param options - Optional configuration for conversion
 * @returns A new value with all keys converted
 *
 * @example
 * ```ts
 * const input = { thinkingBudget: 1024, nestedConfig: { includeThoughts: true } }
 * const output = convertKeysDeep(input, camelToSnakeKey)
 * // { thinking_budget: 1024, nested_config: { include_thoughts: true } }
 * ```
 */
export function convertKeysDeep<R = unknown>(
  value: unknown,
  converter: KeyConverter,
  options?: ConvertKeysDeepOptions
): R {
  // Handle null, undefined, and primitives
  if (value === null || value === undefined) {
    return value as R
  }

  if (typeof value !== 'object') {
    return value as R
  }

  const preserveKeys = options?.preserveKeys ?? []
  const preserveTree = options?.preserveTree ?? []

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => convertKeysDeep(item, converter, options)) as R
  }

  // Handle objects
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(value)) {
    if (preserveTree.includes(key)) {
      result[key] = (value as Record<string, unknown>)[key]
      continue
    }

    const newKey = preserveKeys.includes(key) ? key : converter(key)
    const originalValue = (value as Record<string, unknown>)[key]
    result[newKey] = convertKeysDeep(originalValue, converter, options)
  }

  return result as R
}
