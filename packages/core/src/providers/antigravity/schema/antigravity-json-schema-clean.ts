/**
 * JSON Schema Cleaning for Antigravity API
 *
 * Ported from CLIProxyAPI's CleanJSONSchemaForAntigravity to ensure compatibility
 * with Antigravity's strict schema requirements (VALIDATED mode).
 */

import type { JSONSchema, JSONSchemaProperty } from '../../../types/unified'

/**
 * Unsupported constraint keywords that should be moved to description hints.
 * Claude/Gemini reject these in VALIDATED mode.
 */
const UNSUPPORTED_CONSTRAINTS = [
  'minLength',
  'maxLength',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'pattern',
  'minItems',
  'maxItems',
  'format',
  'default',
  'examples',
] as const

/**
 * Keywords that should be removed after hint extraction.
 */
const UNSUPPORTED_KEYWORDS = [
  ...UNSUPPORTED_CONSTRAINTS,
  '$schema',
  '$defs',
  'definitions',
  'const',
  '$ref',
  'additionalProperties',
  'propertyNames',
  'title',
  '$id',
  '$comment',
  'allOf',
] as const

/**
 * Mutable schema node type for intermediate transformations.
 * Allows flexible property access during recursive schema cleaning.
 */
type MutableSchemaNode = {
  type?: string
  description?: string
  properties?: Record<string, MutableSchemaNode>
  required?: string[]
  items?: MutableSchemaNode
  enum?: unknown[]
  additionalProperties?: boolean | MutableSchemaNode
  allOf?: MutableSchemaNode[]
  $ref?: string
  const?: unknown
  [key: string]: unknown
}

type SchemaInput = JSONSchema | JSONSchemaProperty | Record<string, unknown>

/**
 * Main entry point for schema cleaning.
 * Applies a pipeline of transformations to make the schema compatible with Antigravity.
 */
export function cleanJSONSchemaForAntigravity<T extends SchemaInput>(schema: T): T {
  let cleaned: MutableSchemaNode = JSON.parse(JSON.stringify(schema)) // Deep clone

  // Phase 1: Convert structures to hints and simplified forms
  cleaned = convertRefsToHints(cleaned)
  cleaned = mergeAllOf(cleaned)
  cleaned = convertConstToEnum(cleaned)
  cleaned = addAdditionalPropertiesHints(cleaned)
  cleaned = moveConstraintsToDescription(cleaned)
  cleaned = addEnumHints(cleaned)

  // Phase 2: Strip unsupported keywords
  cleaned = stripUnsupportedKeywords(cleaned)

  // Phase 3: Filter out required fields that are not in properties
  cleaned = filterUndefinedRequired(cleaned)

  // Phase 4: Ensure object schemas are non-empty (Claude VALIDATED compat)
  cleaned = ensureNonEmptyObjectSchemas(cleaned)

  return cleaned as T
}

/**
 * Type guard to check if a value is a schema-like object.
 */
function isSchemaObject(value: unknown): value is MutableSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Phase 4: Ensure object schemas are non-empty.
 * Claude VALIDATED mode requires tool parameters to be an object schema with at least one property.
 */
function ensureNonEmptyObjectSchemas(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      ensureNonEmptyObjectSchemas(item)
    ) as unknown as MutableSchemaNode
  }

  const result: MutableSchemaNode = { ...schema }

  // If this is an object with no properties, add a placeholder
  if (result.type === 'object') {
    const props = result.properties ?? {}
    const propKeys = Object.keys(props)

    if (propKeys.length === 0) {
      const placeholderProp: MutableSchemaNode = {
        type: 'boolean',
        description: 'Placeholder field required by Claude VALIDATED tool schema; do not use.',
      }

      result.properties = {
        ...props,
        _placeholder: placeholderProp,
      }

      // Ensure required includes _placeholder
      const existingRequired = Array.isArray(result.required) ? result.required : []
      if (!existingRequired.includes('_placeholder')) {
        result.required = [...existingRequired, '_placeholder']
      }
    }
  }

  // Recurse into nested objects
  if (result.properties) {
    for (const [key, value] of Object.entries(result.properties)) {
      if (isSchemaObject(value)) {
        result.properties[key] = ensureNonEmptyObjectSchemas(value)
      }
    }
  }

  if (result.items && isSchemaObject(result.items)) {
    result.items = ensureNonEmptyObjectSchemas(result.items)
  }

  return result
}

/**
 * Phase 3: Filter out required fields that are not in properties.
 * Antigravity requires that all fields in 'required' are present in 'properties'.
 */
function filterUndefinedRequired(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      filterUndefinedRequired(item)
    ) as unknown as MutableSchemaNode
  }

  const result: MutableSchemaNode = { ...schema }

  if (result.type === 'object' && Array.isArray(result.required) && result.properties) {
    const definedProps = Object.keys(result.properties)
    result.required = result.required.filter((req: string) => definedProps.includes(req))

    // If required becomes empty, remove it (cleaner)
    if (result.required.length === 0) {
      delete result.required
    }
  }

  // Recursively process properties
  if (result.properties) {
    for (const [key, value] of Object.entries(result.properties)) {
      if (isSchemaObject(value)) {
        result.properties[key] = filterUndefinedRequired(value)
      }
    }
  }

  // Recursively process other nested objects
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'properties' && isSchemaObject(value)) {
      result[key] = filterUndefinedRequired(value)
    }
  }

  return result
}

/**
 * Appends a hint to a schema's description field.
 */
function appendDescriptionHint(schema: MutableSchemaNode, hint: string): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }
  const existing = typeof schema.description === 'string' ? schema.description : ''
  const newDescription = existing ? `${existing} (${hint})` : hint
  return { ...schema, description: newDescription }
}

/**
 * Phase 1a: Converts $ref to description hints.
 * $ref: "#/$defs/Foo" -> { type: "object", description: "See: Foo" }
 */
function convertRefsToHints(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      convertRefsToHints(item)
    ) as unknown as MutableSchemaNode
  }

  // If this object has $ref, replace it with a hint
  if (typeof schema.$ref === 'string') {
    const refVal = schema.$ref
    const defName = refVal.includes('/') ? refVal.split('/').pop() : refVal
    const hint = `See: ${defName}`
    const existingDesc = typeof schema.description === 'string' ? schema.description : ''
    const newDescription = existingDesc ? `${existingDesc} (${hint})` : hint

    // Antigravity requires a type, default to object for refs if not specified
    // Note: This loses the actual structure, but prevents 500 errors
    return { type: 'object', description: newDescription }
  }

  // Recursively process all properties
  const result: MutableSchemaNode = {}
  for (const [key, value] of Object.entries(schema)) {
    if (isSchemaObject(value)) {
      result[key] = convertRefsToHints(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => (isSchemaObject(item) ? convertRefsToHints(item) : item))
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Phase 1b: Converts const to enum.
 * { const: "foo" } -> { enum: ["foo"] }
 */
function convertConstToEnum(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      convertConstToEnum(item)
    ) as unknown as MutableSchemaNode
  }

  const result: MutableSchemaNode = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'const' && !schema.enum) {
      result.enum = [value]
    } else if (isSchemaObject(value)) {
      result[key] = convertConstToEnum(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => (isSchemaObject(item) ? convertConstToEnum(item) : item))
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Phase 1c: Adds enum hints to description.
 * { enum: ["a", "b", "c"] } -> adds "(Allowed: a, b, c)" to description
 */
function addEnumHints(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      addEnumHints(item)
    ) as unknown as MutableSchemaNode
  }

  let result: MutableSchemaNode = { ...schema }

  // Add enum hint if enum has 2-10 items
  if (Array.isArray(result.enum) && result.enum.length > 1 && result.enum.length <= 10) {
    const vals = result.enum.map((v) => String(v)).join(', ')
    result = appendDescriptionHint(result, `Allowed: ${vals}`)
  }

  // Recursively process nested objects
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'enum' && isSchemaObject(value)) {
      result[key] = addEnumHints(value)
    }
  }

  return result
}

/**
 * Phase 1d: Adds additionalProperties hints.
 * { additionalProperties: false } -> adds "(No extra properties allowed)" to description
 */
function addAdditionalPropertiesHints(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      addAdditionalPropertiesHints(item)
    ) as unknown as MutableSchemaNode
  }

  let result: MutableSchemaNode = { ...schema }

  if (result.additionalProperties === false) {
    result = appendDescriptionHint(result, 'No extra properties allowed')
  }

  // Recursively process nested objects
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'additionalProperties' && isSchemaObject(value)) {
      result[key] = addAdditionalPropertiesHints(value)
    }
  }

  return result
}

/**
 * Phase 1e: Moves unsupported constraints to description hints.
 * { minLength: 1, maxLength: 100 } -> adds "(minLength: 1) (maxLength: 100)" to description
 */
function moveConstraintsToDescription(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      moveConstraintsToDescription(item)
    ) as unknown as MutableSchemaNode
  }

  let result: MutableSchemaNode = { ...schema }

  // Move constraint values to description
  for (const constraint of UNSUPPORTED_CONSTRAINTS) {
    if (result[constraint] !== undefined && typeof result[constraint] !== 'object') {
      result = appendDescriptionHint(result, `${constraint}: ${result[constraint]}`)
    }
  }

  // Recursively process nested objects
  for (const [key, value] of Object.entries(result)) {
    if (isSchemaObject(value)) {
      result[key] = moveConstraintsToDescription(value)
    }
  }

  return result
}

/**
 * Phase 2a: Merges allOf schemas into a single object.
 * { allOf: [{ properties: { a: ... } }, { properties: { b: ... } }] }
 * -> { properties: { a: ..., b: ... } }
 */
function mergeAllOf(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      mergeAllOf(item)
    ) as unknown as MutableSchemaNode
  }

  const result: MutableSchemaNode = { ...schema }

  // If this object has allOf, merge its contents
  if (Array.isArray(result.allOf)) {
    const merged: MutableSchemaNode = {}
    const mergedRequired: string[] = []

    for (const item of result.allOf) {
      if (!isSchemaObject(item)) continue

      // Merge properties
      if (item.properties && typeof item.properties === 'object') {
        merged.properties = { ...merged.properties, ...item.properties }
      }

      // Merge required arrays
      if (Array.isArray(item.required)) {
        for (const req of item.required) {
          if (!mergedRequired.includes(req)) {
            mergedRequired.push(req)
          }
        }
      }

      // Copy other fields from allOf items
      for (const [key, value] of Object.entries(item)) {
        if (key !== 'properties' && key !== 'required' && merged[key] === undefined) {
          merged[key] = value
        }
      }
    }

    // Apply merged content to result
    if (merged.properties) {
      result.properties = { ...result.properties, ...merged.properties }
    }
    if (mergedRequired.length > 0) {
      const existingRequired = Array.isArray(result.required) ? result.required : []
      result.required = Array.from(new Set([...existingRequired, ...mergedRequired]))
    }

    // Copy other merged fields
    for (const [key, value] of Object.entries(merged)) {
      if (
        key !== 'properties' &&
        key !== 'required' &&
        result[key] === undefined &&
        !['allOf'].includes(key)
      ) {
        result[key] = value
      }
    }
  }

  // Recursively process nested objects
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'allOf' && isSchemaObject(value)) {
      result[key] = mergeAllOf(value)
    }
  }

  return result
}

/**
 * Phase 3: Strips unsupported keywords from the schema.
 */
function stripUnsupportedKeywords(schema: MutableSchemaNode): MutableSchemaNode {
  if (!isSchemaObject(schema)) {
    return schema
  }

  if (Array.isArray(schema)) {
    return (schema as unknown as MutableSchemaNode[]).map((item) =>
      stripUnsupportedKeywords(item)
    ) as unknown as MutableSchemaNode
  }

  const result: MutableSchemaNode = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!(UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) {
      if (isSchemaObject(value)) {
        result[key] = stripUnsupportedKeywords(value)
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          isSchemaObject(item) ? stripUnsupportedKeywords(item) : item
        )
      } else {
        result[key] = value
      }
    }
  }
  return result
}
