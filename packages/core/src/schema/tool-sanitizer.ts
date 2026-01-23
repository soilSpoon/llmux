import type { JSONSchemaProperty as JSONSchema } from '../types/json-schema'
import type { UnifiedTool } from '../types/unified'
import { encodeAntigravityToolName } from './reversible-tool-name'

/**
 * Tool Sanitizer Utility
 *
 * Provides utilities for sanitizing and normalizing tool schemas,
 * particularly for handling non-standard or client-specific schema patterns
 * (e.g., opencode custom.input_schema wrappers).
 */

/**
 * Recursively sanitizes a JSON schema by removing 'custom' fields
 * and flattening unexpected structures.
 */
export function sanitizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema)
  }

  // Create a shallow copy to safely mutate or reassign properties
  const result = { ...(schema as Record<string, unknown>) }

  // Remove logical 'custom' field if present at this level
  if ('custom' in result) {
    delete result.custom
  }

  // Recurse into properties
  if (result.properties && typeof result.properties === 'object') {
    const props = { ...(result.properties as Record<string, unknown>) }

    // Explicitly remove 'custom' property if it exists
    if ('custom' in props) {
      delete props.custom
    }

    // Only iterate if we haven't already processed
    for (const key of Object.keys(props)) {
      if (key !== 'custom') {
        props[key] = sanitizeSchema(props[key])
      }
    }
    result.properties = props
  }

  // Recurse into items
  if (result.items) {
    result.items = sanitizeSchema(result.items)
  }

  // Recurse into logical combinators
  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map(sanitizeSchema)
  }
  if (Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map(sanitizeSchema)
  }
  if (Array.isArray(result.allOf)) {
    result.allOf = result.allOf.map(sanitizeSchema)
  }

  // Filter 'required' to only include extant properties
  if (Array.isArray(result.required)) {
    const validProps = (result.properties || {}) as Record<string, unknown>
    const required = result.required as string[]
    const filtered = required.filter((key) => key in validProps)
    if (filtered.length === 0) {
      delete result.required
    } else {
      result.required = filtered
    }
  }

  return result
}

/**
 * Preprocesses tools to handle specific requirements
 * - Flattens custom.input_schema wrapper if present (Opencode compatibility)
 * - Encodes tool names for Antigravity compatibility if needed
 */
export function preprocessTools(tools: UnifiedTool[] | undefined): UnifiedTool[] | undefined {
  if (!tools) return undefined

  return tools.map((tool) => {
    let parameters = tool.parameters

    // Check for custom.input_schema wrapper pattern
    // Structure: parameters -> properties -> custom -> properties -> input_schema
    const props = tool.parameters?.properties
    if (props && 'custom' in props) {
      const customProp = props.custom as { properties?: { input_schema?: JSONSchema } }
      if (customProp?.properties?.input_schema) {
        parameters = customProp.properties.input_schema
      }
    }

    // Sanitize parameters to remove any remaining 'custom' fields
    if (parameters) {
      parameters = sanitizeSchema(parameters) as JSONSchema
    }

    const result = {
      ...tool,
      name: encodeAntigravityToolName(tool.name),
      parameters,
    }

    // Remove 'custom' from top-level tool if present
    if ('custom' in result) {
      delete (result as Record<string, unknown>).custom
    }

    return result
  })
}
