import type { JSONSchemaProperty as Schema } from '../../../types/json-schema.js'

const FORBIDDEN_KEYWORDS: readonly string[] = [
  '$ref',
  '$defs',
  'definitions',
  'allOf',
  'anyOf',
  'oneOf',
]

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * 정제된 스키마가 Antigravity API 요구사항을 충족하는지 검증합니다.
 */
export function validateSanitizedSchema(schema: Schema): ValidationResult {
  const errors: string[] = []

  // 1. 최상위 type이 object인지 확인
  if (schema.type !== 'object') {
    errors.push(`Top-level type must be "object", got "${schema.type}"`)
  }

  // 2. properties 존재 여부
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    errors.push('Schema must have at least one property')
  }

  // 3. required 키가 properties에 모두 존재하는지 확인
  if (schema.required && schema.properties) {
    for (const key of schema.required) {
      if (!(key in schema.properties)) {
        errors.push(`Required key "${key}" not found in properties`)
      }
    }
  }

  // 4. 금지된 키워드 확인
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (keyword in schema) {
      errors.push(`Forbidden keyword "${keyword}" found in schema`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
