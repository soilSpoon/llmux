/**
 * Sanitizes JSON schemas for Google Gemini API compatibility.
 * Gemini API is strict and does not support $ref, const, or additionalProperties.
 */
export function sanitizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSchema(item))
  }

  const source = schema as Record<string, unknown>
  const sanitized: Record<string, unknown> = { ...source }

  if ('const' in sanitized) {
    sanitized.enum = [sanitized.const]
    delete sanitized.const
  }

  if ('$ref' in sanitized) {
    delete sanitized.$ref
    if (Object.keys(sanitized).length === 0) {
      sanitized.type = 'object'
    }
  }

  if ('additionalProperties' in sanitized) {
    delete sanitized.additionalProperties
  }

  const properties = sanitized.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const newProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      newProps[key] = sanitizeSchema(value)
    }
    sanitized.properties = newProps
  }

  if (sanitized.items) {
    sanitized.items = sanitizeSchema(sanitized.items)
  }

  return sanitized
}
