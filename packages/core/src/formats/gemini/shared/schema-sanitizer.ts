import type { JSONSchemaProperty as Schema } from '../../../types/json-schema.js'
import type { GeminiSchema } from '../gemini-cli/types.js'
import { inlineSchemaRefs } from './schema-inliner.js'
import { mergeSchemaCombinators } from './schema-merger.js'

const UNSUPPORTED_KEYS = [
  'title',
  'default',
  'examples',
  'additionalProperties',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'exclusiveMinimum',
  'exclusiveMaximum',
  '$schema',
  '$id',
  '$comment',
] as const

type TypeMapping = {
  string: 'STRING'
  number: 'NUMBER'
  integer: 'INTEGER'
  boolean: 'BOOLEAN'
  array: 'ARRAY'
  object: 'OBJECT'
  null: 'STRING' // null은 STRING으로 매핑 (Gemini는 null 타입 미지원)
}

const TYPE_MAP: TypeMapping = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
  null: 'STRING',
}

/**
 * Antigravity API용 스키마 정제 및 Gemini 포맷으로 변환
 */
export function cleanSchemaForAntigravity(schema: Schema): GeminiSchema {
  const processed = mergeSchemaCombinators(inlineSchemaRefs(schema))
  return toGeminiSchema(processed)
}

function toGeminiSchema(current: Schema): GeminiSchema {
  if (!current || typeof current !== 'object') {
    return {}
  }

  const result: GeminiSchema = {}

  // type 변환 (소문자 → 대문자)
  if (current.type && current.type in TYPE_MAP) {
    result.type = TYPE_MAP[current.type as keyof TypeMapping]
  }

  // description 및 힌트 추가
  const hints: string[] = []
  for (const key of UNSUPPORTED_KEYS) {
    const value = current[key as keyof Schema]
    if (value !== undefined) {
      const label = key.charAt(0).toUpperCase() + key.slice(1)
      hints.push(`${label}: ${JSON.stringify(value)}`)
    }
  }

  const existingDesc = current.description || ''
  if (hints.length > 0) {
    result.description = [existingDesc, ...hints].filter(Boolean).join('\n')
  } else if (existingDesc) {
    result.description = existingDesc
  }

  // const → enum 변환
  if (current.const !== undefined) {
    result.enum = [String(current.const)]
  } else if (current.enum) {
    result.enum = current.enum.map(String)
  }

  // nullable
  if (current.nullable) {
    result.nullable = true
  }

  // required
  if (current.required && current.required.length > 0) {
    // Filter out required fields that were removed or don't exist
    const validRequired = current.required.filter((key) => {
      if (key === 'custom') return false
      return !!current.properties && key in current.properties
    })
    if (validRequired.length > 0) {
      result.required = validRequired
    }
  }

  // properties 재귀 처리
  if (current.properties) {
    const newProps: Record<string, GeminiSchema> = {}
    for (const [key, value] of Object.entries(current.properties)) {
      if (key === 'custom') continue // 필터링
      newProps[key] = toGeminiSchema(value)
    }

    // 빈 객체 스키마 placeholder 추가
    if (Object.keys(newProps).length === 0 && result.type === 'OBJECT') {
      newProps._placeholder = { type: 'STRING', description: 'Empty object placeholder' }
    }

    result.properties = newProps
  }

  // items 재귀 처리
  if (current.items) {
    result.items = toGeminiSchema(current.items)
  }

  return result
}
