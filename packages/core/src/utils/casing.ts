/**
 * Casing Utilities
 *
 * Reusable functions for converting between camelCase and snake_case keys.
 */

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
