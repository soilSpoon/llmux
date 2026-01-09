import { describe, expect, test } from 'bun:test'
import { detectFormat } from '../../src/middleware/format'

describe('detectFormat', () => {
  test('detects OpenAI chat format from URL', () => {
    expect(detectFormat('/v1/chat/completions')).toBe('openai-chat')
  })

  test('detects OpenAI responses (embeddings/others) format from URL', () => {
    expect(detectFormat('/v1/responses')).toBe('openai-responses')
  })

  test('detects Anthropic messages format from URL', () => {
    expect(detectFormat('/v1/messages')).toBe('anthropic-messages')
  })

  test('detects Google Gemini format from URL', () => {
    expect(detectFormat('/v1/models/gemini-pro:generateContent')).toBe('google-gemini')
  })

  test('throws on unknown URL pattern', () => {
    expect(() => detectFormat('/v1/unknown')).toThrow('Unknown request format')
  })

  test('throws on empty URL', () => {
    expect(() => detectFormat('')).toThrow('Unknown request format')
  })

  test('detects format with query parameters', () => {
    expect(detectFormat('/v1/chat/completions?stream=true')).toBe('openai-chat')
  })
})
