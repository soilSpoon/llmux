import type { JSONSchemaProperty } from '../types/unified'
import { sanitizeSchema } from './sanitize'

type SchemaWithExtras = JSONSchemaProperty & {
  const?: unknown
  $defs?: Record<string, JSONSchemaProperty>
  definitions?: Record<string, JSONSchemaProperty>
  $ref?: string
  any_of?: JSONSchemaProperty[]
}

export function constToEnum(schema: JSONSchemaProperty): JSONSchemaProperty {
  return transformRecursive(schema, (s) => {
    const ext = s as SchemaWithExtras
    if ('const' in ext && ext.const !== undefined) {
      const { const: constValue, ...rest } = ext
      return { ...rest, enum: [constValue] } as JSONSchemaProperty
    }
    return s
  })
}

export function inlineRefs(schema: JSONSchemaProperty): JSONSchemaProperty {
  const ext = schema as SchemaWithExtras
  const defs = ext.$defs || ext.definitions || {}

  if (Object.keys(defs).length === 0) {
    return schema
  }

  const inlinedDefs: Record<string, JSONSchemaProperty> = {}
  for (const [name, def] of Object.entries(defs)) {
    inlinedDefs[name] = inlineRefs(def)
  }

  const result = inlineRefsRecursive(schema, inlinedDefs)
  const resultExt = result as SchemaWithExtras
  delete resultExt.$defs
  delete resultExt.definitions

  return result
}

function inlineRefsRecursive(
  schema: JSONSchemaProperty,
  defs: Record<string, JSONSchemaProperty>
): JSONSchemaProperty {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const ext = schema as SchemaWithExtras

  if (ext.$ref) {
    const refPath = ext.$ref
    const match = refPath.match(/^#\/(\$defs|definitions)\/(.+)$/)
    if (match?.[2]) {
      const defName = match[2]
      if (defs[defName]) {
        return inlineRefsRecursive(defs[defName], defs)
      }
    }
    return schema
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$defs' || key === 'definitions') {
      continue
    }

    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, JSONSchemaProperty> = {}
      for (const [propName, propValue] of Object.entries(
        value as Record<string, JSONSchemaProperty>
      )) {
        props[propName] = inlineRefsRecursive(propValue, defs)
      }
      result.properties = props
    } else if (key === 'items' && value && typeof value === 'object') {
      result.items = inlineRefsRecursive(value as JSONSchemaProperty, defs)
    } else if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      result[key] = value.map((item) => inlineRefsRecursive(item as JSONSchemaProperty, defs))
    } else if (key === 'additionalProperties' && value && typeof value === 'object') {
      result.additionalProperties = inlineRefsRecursive(value as JSONSchemaProperty, defs)
    } else {
      result[key] = value
    }
  }

  return result as JSONSchemaProperty
}

export function anyOfToSnakeCase(schema: JSONSchemaProperty): JSONSchemaProperty {
  return transformRecursive(schema, (s) => {
    if (s.anyOf && Array.isArray(s.anyOf)) {
      const { anyOf, ...rest } = s
      const result = rest as SchemaWithExtras
      result.any_of = anyOf
      return result as JSONSchemaProperty
    }
    return s
  })
}

export function addEmptySchemaPlaceholder(schema: JSONSchemaProperty): JSONSchemaProperty {
  return transformRecursive(schema, (s) => {
    if (!s.type && !s.anyOf && !s.oneOf && !s.allOf && Object.keys(s).length === 0) {
      return { type: 'object' } as JSONSchemaProperty
    }
    if (!s.type && !s.anyOf && !s.oneOf && !s.allOf) {
      return { ...s, type: 'object' } as JSONSchemaProperty
    }
    return s
  })
}

export function transformSchema(schema: JSONSchemaProperty): JSONSchemaProperty {
  let result = schema

  result = inlineRefs(result)
  result = sanitizeSchema(result)
  result = constToEnum(result)
  result = anyOfToSnakeCase(result)
  result = addEmptySchemaPlaceholder(result)

  return result
}

function transformRecursive(
  schema: JSONSchemaProperty,
  transform: (s: JSONSchemaProperty) => JSONSchemaProperty
): JSONSchemaProperty {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  let result = transform(schema)

  if (result.properties) {
    const props: Record<string, JSONSchemaProperty> = {}
    for (const [key, value] of Object.entries(result.properties)) {
      props[key] = transformRecursive(value, transform)
    }
    result = { ...result, properties: props }
  }

  if (result.items && typeof result.items === 'object') {
    result = { ...result, items: transformRecursive(result.items, transform) }
  }

  if (result.anyOf && Array.isArray(result.anyOf)) {
    result = { ...result, anyOf: result.anyOf.map((item) => transformRecursive(item, transform)) }
  }

  if (result.oneOf && Array.isArray(result.oneOf)) {
    result = { ...result, oneOf: result.oneOf.map((item) => transformRecursive(item, transform)) }
  }

  if (result.allOf && Array.isArray(result.allOf)) {
    result = { ...result, allOf: result.allOf.map((item) => transformRecursive(item, transform)) }
  }

  if (result.additionalProperties && typeof result.additionalProperties === 'object') {
    result = {
      ...result,
      additionalProperties: transformRecursive(
        result.additionalProperties as JSONSchemaProperty,
        transform
      ),
    }
  }

  const ext = result as SchemaWithExtras
  if (ext.any_of && Array.isArray(ext.any_of)) {
    ext.any_of = ext.any_of.map((item) => transformRecursive(item, transform))
    result = ext as JSONSchemaProperty
  }

  return result
}
