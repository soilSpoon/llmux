import { describe, expect, test } from 'bun:test'
import { sanitizeForLogging, assertNoThoughtSignatureString } from '../sanitize-for-logging'

interface ThinkingPart {
  type: string
  thinking: string
  thoughtSignature?: string
  nested: {
    deep: {
      thought_signature?: string
    }
  }
}

interface TestObject {
  role: string
  parts: (ThinkingPart | { type: string; text: string })[]
}

describe('sanitizeForLogging', () => {
  test('should strip thoughtSignature from flat object', () => {
    const input = {
      content: 'hello',
      thoughtSignature: 'sig_12345',
      thought_signature: 'sig_67890'
    }
    const output = sanitizeForLogging(input) as { content: string }
    expect(output).toEqual({ content: 'hello' })
    expect(output).not.toHaveProperty('thoughtSignature')
    expect(output).not.toHaveProperty('thought_signature')
  })

  test('should strip thoughtSignature from nested object', () => {
    const input: TestObject = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'hello' },
        { 
          type: 'thinking', 
          thinking: 'hmm', 
          thoughtSignature: 'sig_nested',
          nested: {
            deep: {
              thought_signature: 'sig_deep'
            }
          }
        }
      ]
    }
    const output = sanitizeForLogging(input)
    
    expect(output.parts[1]).toBeDefined()
    const thinkingPart = output.parts[1] as ThinkingPart
    expect(thinkingPart).not.toHaveProperty('thoughtSignature')
    expect(thinkingPart.nested?.deep).not.toHaveProperty('thought_signature')
    expect(output.parts[0]).toEqual({ type: 'text', text: 'hello' })
  })

  test('should handle arrays', () => {
    const input = [
      { id: 1, thoughtSignature: 's1' },
      { id: 2, thought_signature: 's2' }
    ]
    const output = sanitizeForLogging(input)
    expect(output).toHaveLength(2)
    expect(output[0]).toBeDefined()
    expect(output[1]).toBeDefined()
    expect(output[0]).not.toHaveProperty('thoughtSignature')
    expect(output[1]).not.toHaveProperty('thought_signature')
    // @ts-ignore
    expect(output[0].id).toBe(1)
  })

  test('should not mutate original object', () => {
    const input = { thoughtSignature: 'keep_me_in_original' }
    const output = sanitizeForLogging(input)
    expect(output).not.toHaveProperty('thoughtSignature')
    expect(input).toHaveProperty('thoughtSignature')
  })

  test('should handle null/undefined/primitives', () => {
    expect(sanitizeForLogging(null)).toBeNull()
    expect(sanitizeForLogging(undefined)).toBeUndefined()
    expect(sanitizeForLogging('string')).toBe('string')
    expect(sanitizeForLogging(123)).toBe(123)
  })
})

describe('assertNoThoughtSignatureString', () => {
  test('should return true when no signature present', () => {
    expect(assertNoThoughtSignatureString('{"content": "hello"}')).toBe(true)
  })

  test('should return false when thoughtSignature key is present', () => {
    expect(assertNoThoughtSignatureString('{"thoughtSignature": "s1"}')).toBe(false)
  })

  test('should return false when thought_signature key is present', () => {
    expect(assertNoThoughtSignatureString('{"thought_signature": "s1"}')).toBe(false)
  })
})
