import type { JSONSchemaProperty } from '../types/unified'

const DISALLOWED_FIELDS = new Set(['$schema', '$id', 'default', 'examples', 'title'])

export function sanitizeSchema(schema: JSONSchemaProperty): JSONSchemaProperty {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    if (DISALLOWED_FIELDS.has(key)) {
      continue
    }

    if (key === 'properties' && value && typeof value === 'object') {
      result.properties = sanitizeProperties(value as Record<string, JSONSchemaProperty>)
    } else if (key === 'items' && value && typeof value === 'object') {
      result.items = sanitizeSchema(value as JSONSchemaProperty)
    } else if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      result[key] = value.map((item) => sanitizeSchema(item as JSONSchemaProperty))
    } else if (key === 'additionalProperties') {
      if (typeof value === 'boolean') {
        result.additionalProperties = value
      } else if (value && typeof value === 'object') {
        result.additionalProperties = sanitizeSchema(value as JSONSchemaProperty)
      }
    } else if (value !== undefined) {
      result[key] = value
    }
  }

  return result as JSONSchemaProperty
}

function sanitizeProperties(
  properties: Record<string, JSONSchemaProperty>
): Record<string, JSONSchemaProperty> {
  const result: Record<string, JSONSchemaProperty> = {}

  for (const [key, value] of Object.entries(properties)) {
    result[key] = sanitizeSchema(value)
  }

  return result
}
