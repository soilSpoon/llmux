import { describe, expect, it } from 'bun:test'
import { parseGeminiStreamChunk } from '../../../../src/formats/gemini/streaming/parser'

describe('Gemini Stream Parser - Signature Injection', () => {
  it('should inject thinking-delta when signature is present in text block', () => {
    const chunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                thoughtSignature: 'test-signature-abc',
                text: 'Hello world',
              },
            ],
          },
        },
      ],
    }

    const result = parseGeminiStreamChunk(chunk)

    expect(result).not.toBeNull()
    if (result) {
      expect(result.length).toBe(2)

      // First chunk should be thinking-delta with signature
      const chunk1 = result[0]
      if (chunk1) {
        expect(chunk1.type).toBe('thinking-delta')
        expect(chunk1.delta?.thinking?.signature).toBe('test-signature-abc')
        expect(chunk1.delta?.thinking?.text).toBe('')
      }

      // Second chunk should be text-delta
      const chunk2 = result[1]
      if (chunk2) {
        expect(chunk2.type).toBe('text-delta')
        expect(chunk2.delta?.text).toBe('Hello world')
      }
    }
  })

  it('should NOT inject thinking-delta when signature is missing in text block', () => {
    const chunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                text: 'Just text',
              },
            ],
          },
        },
      ],
    }

    const result = parseGeminiStreamChunk(chunk)

    expect(result).not.toBeNull()
    if (result) {
      expect(result.length).toBe(1)

      const chunk1 = result[0]
      if (chunk1) {
        expect(chunk1.type).toBe('text-delta')
        expect(chunk1.delta?.text).toBe('Just text')
      }
    }
  })

  it('should handle thought_signature (snake_case) as well', () => {
    const chunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                thought_signature: 'snake-case-sig',
                text: 'Hello',
              },
            ],
          },
        },
      ],
    }

    const result = parseGeminiStreamChunk(chunk)

    expect(result).not.toBeNull()
    if (result) {
      expect(result.length).toBe(2)

      const chunk1 = result[0]
      if (chunk1) {
        expect(chunk1.type).toBe('thinking-delta')
        expect(chunk1.delta?.thinking?.signature).toBe('snake-case-sig')
      }
    }
  })
})