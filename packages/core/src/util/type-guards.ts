import type { JsonObject, JsonValue } from '../types/json-schema.js'

/**
 * Checks if a value is a Record<string, unknown> (non-null object).
 */
export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Checks if a value is a JsonObject.
 */
export function isJsonObject(val: unknown): val is JsonObject {
  return isRecord(val)
}

/**
 * Checks if a value is a JsonValue (primitive, object, or array).
 */
export function isJsonValue(val: unknown): val is JsonValue {
  if (
    val === null ||
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'boolean'
  ) {
    return true
  }
  if (Array.isArray(val)) {
    return val.every(isJsonValue)
  }
  if (isRecord(val)) {
    return Object.values(val).every(isJsonValue)
  }
  return false
}
