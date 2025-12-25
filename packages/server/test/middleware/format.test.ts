import { describe, expect, test } from 'bun:test'
import { detectFormat } from '../../src/middleware/format'

describe('detectFormat', () => {
  test('detects OpenAI format (model + messages, no system)', () => {
    const body = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    }
    expect(detectFormat(body)).toBe('openai')
  })

  test('detects Anthropic format (model + messages + system)', () => {
    const body = {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are a helpful assistant',
    }
    expect(detectFormat(body)).toBe('anthropic')
  })

  test('detects Anthropic format with null system', () => {
    const body = {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      system: null,
    }
    expect(detectFormat(body)).toBe('anthropic')
  })

  test('detects Anthropic format with empty system', () => {
    const body = {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      system: '',
    }
    expect(detectFormat(body)).toBe('anthropic')
  })

  test('detects Gemini format (contents)', () => {
    const body = {
      contents: [{ parts: [{ text: 'Hello' }], role: 'user' }],
    }
    expect(detectFormat(body)).toBe('gemini')
  })

  test('detects Antigravity format (payload.contents)', () => {
    const body = {
      payload: {
        contents: [{ parts: [{ text: 'Hello' }], role: 'user' }],
      },
    }
    expect(detectFormat(body)).toBe('antigravity')
  })

  test('throws on unknown format', () => {
    const body = { unknown: 'format' }
    expect(() => detectFormat(body)).toThrow('Unknown request format')
  })

  test('throws on null body', () => {
    expect(() => detectFormat(null)).toThrow('Unknown request format')
  })

  test('throws on undefined body', () => {
    expect(() => detectFormat(undefined)).toThrow('Unknown request format')
  })

  test('prioritizes Antigravity over Gemini when both match', () => {
    const body = {
      payload: {
        contents: [{ parts: [{ text: 'Hello' }] }],
      },
      contents: [{ parts: [{ text: 'Hello' }] }],
    }
    expect(detectFormat(body)).toBe('antigravity')
  })
})
