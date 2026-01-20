export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonArray | JsonObject

export interface JsonArray extends Array<JsonValue> {}

export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export type JsonRecord = JsonObject
export type JsonMap = JsonObject

/**
 * JSON Schema property 타입
 */
export interface JSONSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'
  description?: string
  enum?: JsonPrimitive[]
  const?: JsonPrimitive
  default?: JsonValue
  title?: string
  format?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minItems?: number
  maxItems?: number
  items?: JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  additionalProperties?: boolean | JSONSchemaProperty
  $ref?: string
  $defs?: Record<string, JSONSchemaProperty>
  definitions?: Record<string, JSONSchemaProperty>
  allOf?: JSONSchemaProperty[]
  anyOf?: JSONSchemaProperty[]
  oneOf?: JSONSchemaProperty[]
  nullable?: boolean
  examples?: JsonValue[]
  $schema?: string
  $id?: string
  $comment?: string
  [key: string]: JsonValue | undefined
}

/**
 * Type guard: JSON record 인지 확인 (stricter than Record<string, unknown>)
 */
export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard: JSON value 인지 확인
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isJsonRecord(value)) {
    return Object.values(value).every((v) => v === undefined || isJsonValue(v))
  }
  return false
}

/**
 * Type guard: JSON Schema property 인지 확인
 */
export function isJSONSchemaProperty(value: unknown): value is JSONSchemaProperty {
  if (!isJsonRecord(value)) return false
  if (value.type !== undefined) {
    const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']
    if (!validTypes.includes(value.type as string)) return false
  }
  return true
}
