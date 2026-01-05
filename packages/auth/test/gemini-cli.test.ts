import { describe, expect, test } from 'bun:test'
import { isGeminiCliModel } from '../src/providers/gemini-cli'

describe('isGeminiCliModel', () => {
  test('returns true for gemini-2.5-flash', () => {
    expect(isGeminiCliModel('gemini-2.5-flash')).toBe(true)
  })

  test('returns true for gemini-2.5-pro', () => {
    expect(isGeminiCliModel('gemini-2.5-pro')).toBe(true)
  })

  test('returns true for gemini-3-pro-preview', () => {
    expect(isGeminiCliModel('gemini-3-pro-preview')).toBe(true)
  })

  test('returns true for gemini-3-flash-preview', () => {
    expect(isGeminiCliModel('gemini-3-flash-preview')).toBe(true)
  })

  test('returns false for claude-sonnet-4-5', () => {
    expect(isGeminiCliModel('claude-sonnet-4-5')).toBe(false)
  })

  test('returns false for gemini-3-pro-high (legacy antigravity)', () => {
    expect(isGeminiCliModel('gemini-3-pro-high')).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isGeminiCliModel(undefined)).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isGeminiCliModel('')).toBe(false)
  })
})
