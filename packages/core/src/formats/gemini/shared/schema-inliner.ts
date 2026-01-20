import type { JSONSchemaProperty as Schema } from '../../../types/json-schema.js'

export interface InlinerOptions {
  maxDepth?: number
}

/**
 * $ref와 $defs를 인라인으로 확장합니다.
 */
export function inlineSchemaRefs(schema: Schema, options: InlinerOptions = {}): Schema {
  const maxDepth = options.maxDepth ?? 10
  const defs: Record<string, Schema> = { ...(schema.$defs || {}), ...(schema.definitions || {}) }

  function resolve(current: Schema, depth: number, visited: Set<string>): Schema {
    if (depth > maxDepth) {
      return { type: 'object', description: 'Max inline depth reached' }
    }

    if ('$ref' in current && current.$ref) {
      const refPath = current.$ref
      const refName = refPath.split('/').pop() || ''

      if (visited.has(refPath)) {
        return { type: 'object', description: `Cyclic ref to ${refName}` }
      }

      const refTarget = defs[refName]
      if (!refTarget) {
        return { type: 'object', description: `Unresolved ref: ${refPath}` }
      }

      const newVisited = new Set(visited)
      newVisited.add(refPath)

      return resolve(refTarget, depth + 1, newVisited)
    }

    const result: Schema = {}

    for (const [key, value] of Object.entries(current)) {
      if (key === '$defs' || key === 'definitions') continue

      if (key === 'properties' && value && typeof value === 'object') {
        const props: Record<string, Schema> = {}
        for (const [propKey, propVal] of Object.entries(value as Record<string, Schema>)) {
          props[propKey] = resolve(propVal, depth, visited)
        }
        result.properties = props
      } else if (key === 'items' && value && typeof value === 'object') {
        result.items = resolve(value as Schema, depth, visited)
      } else if ((key === 'allOf' || key === 'anyOf' || key === 'oneOf') && Array.isArray(value)) {
        ;(result as Record<string, Schema[]>)[key] = (value as Schema[]).map((s) =>
          resolve(s, depth, visited)
        )
      } else {
        ;(result as Record<string, unknown>)[key] = value
      }
    }

    return result
  }

  return resolve(schema, 0, new Set())
}
