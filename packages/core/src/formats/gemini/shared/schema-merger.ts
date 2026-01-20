import type { JSONSchemaProperty as Schema } from '../../../types/json-schema.js'

/**
 * allOf, anyOf, oneOf 조합자를 병합합니다.
 * - allOf: 모든 스키마의 properties를 병합하고,required는 합집합
 * - anyOf/oneOf: properties 병합, required는 교집합 (보수적)
 */
export function mergeSchemaCombinators(schema: Schema): Schema {
  if (!schema || typeof schema !== 'object') return schema

  if (Array.isArray(schema)) {
    return schema.map(mergeSchemaCombinators) as unknown as Schema
  }

  let result: Schema = { ...schema }

  // 1. allOf 처리
  if (result.allOf && Array.isArray(result.allOf)) {
    const subschemas = result.allOf.map(mergeSchemaCombinators)
    const mergedProperties: Record<string, Schema> = {}
    let mergedRequired: string[] = []

    for (const sub of subschemas) {
      if (sub.properties) {
        Object.assign(mergedProperties, sub.properties)
      }
      if (Array.isArray(sub.required)) {
        mergedRequired = [...new Set([...mergedRequired, ...sub.required])]
      }
    }

    const { allOf: _, ...rest } = result
    result = {
      ...rest,
      type: 'object',
      properties: mergedProperties,
      required: mergedRequired,
    }
  }

  // 2. anyOf / oneOf 처리
  const combinator = result.anyOf || result.oneOf
  if (combinator && Array.isArray(combinator)) {
    const subschemas = combinator.map(mergeSchemaCombinators)
    const mergedProperties: Record<string, Schema> = {}

    for (const sub of subschemas) {
      if (sub.properties) {
        Object.assign(mergedProperties, sub.properties)
      }
    }

    // required 교집합
    let mergedRequired: string[] = []
    const first = subschemas[0]
    if (first && subschemas.length > 0 && subschemas.every((s) => Array.isArray(s.required))) {
      const firstRequired = first.required || []
      mergedRequired = firstRequired.filter((key) =>
        subschemas.every((s) => s.required?.includes(key))
      )
    }

    const { anyOf: _a, oneOf: _o, ...rest } = result
    result = {
      ...rest,
      type: 'object',
      properties: mergedProperties,
      required: mergedRequired,
    }
  }

  // 3. 재귀 처리
  if (result.properties) {
    const newProps: Record<string, Schema> = {}
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = mergeSchemaCombinators(value)
    }
    result.properties = newProps
  }

  if (result.items) {
    result.items = mergeSchemaCombinators(result.items)
  }

  return result
}
