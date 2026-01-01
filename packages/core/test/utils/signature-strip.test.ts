import { describe, it, expect } from 'bun:test'
import {
  stripThoughtSignatures,
  stripSignaturesFromContents,
} from '../../src/utils/signature-strip'

type ThinkingPart = {
  thought: true
  text: string
  thoughtSignature?: string
}

type TextPart = {
  text: string
}

type Part = ThinkingPart | TextPart

describe('stripThoughtSignatures', () => {
  it('should remove thoughtSignature from parts with thought: true', () => {
    const input = [
      {
        thought: true,
        text: 'Let me think...',
        thoughtSignature: 'ErADCq0DAXLI2nx...',
      } satisfies ThinkingPart,
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      thought: true,
      text: 'Let me think...',
    })
    expect(result[0]).not.toHaveProperty('thoughtSignature')
  })

  it('should preserve thought: true and text content', () => {
    const input = [
      {
        thought: true,
        text: 'Complex reasoning here',
        thoughtSignature: 'signature123',
      } satisfies ThinkingPart,
    ]

    const result = stripThoughtSignatures(input)

    expect(result[0]).toHaveProperty('thought', true)
    expect(result[0]).toHaveProperty('text', 'Complex reasoning here')
    expect(result[0]).not.toHaveProperty('thoughtSignature')
  })

  it('should leave parts without signature unchanged', () => {
    const input: Part[] = [
      { text: 'The answer is 4' },
      { thought: true, text: 'thinking...' },
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ text: 'The answer is 4' })
    expect(result[1]).toEqual({ thought: true, text: 'thinking...' })
  })

  it('should handle empty array', () => {
    const input: Part[] = []
    const result = stripThoughtSignatures(input)
    expect(result).toEqual([])
  })

  it('should handle multiple parts with mixed signatures', () => {
    const input: Part[] = [
      {
        thought: true,
        text: 'First thought',
        thoughtSignature: 'sig1',
      },
      {
        text: 'Regular response',
      },
      {
        thought: true,
        text: 'Second thought',
        thoughtSignature: 'sig2',
      },
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      thought: true,
      text: 'First thought',
    })
    expect(result[1]).toEqual({
      text: 'Regular response',
    })
    expect(result[2]).toEqual({
      thought: true,
      text: 'Second thought',
    })
  })

  it('should preserve other properties in parts', () => {
    const input = [
      {
        thought: true,
        text: 'thinking',
        thoughtSignature: 'sig',
        customProp: 'value',
      },
    ]

    const result = stripThoughtSignatures(input)

    expect(result[0]).toHaveProperty('customProp', 'value')
    expect(result[0]).not.toHaveProperty('thoughtSignature')
  })
})

type Content = {
  role: string
  parts: Part[]
}

describe('stripSignaturesFromContents', () => {
  it('should remove signatures from contents array', () => {
    const input: Content[] = [
      {
        role: 'model',
        parts: [
          {
            thought: true,
            text: 'thinking',
            thoughtSignature: 'sig1',
          },
          {
            text: 'response',
          },
        ],
      },
    ]

    const result = stripSignaturesFromContents(input)

    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('model')
    expect(result[0]?.parts).toHaveLength(2)
    expect(result[0]?.parts[0]).toEqual({
      thought: true,
      text: 'thinking',
    })
    expect(result[0]?.parts[1]).toEqual({
      text: 'response',
    })
  })

  it('should preserve role and other content properties', () => {
    const input: Content[] = [
      {
        role: 'user',
        parts: [
          {
            text: 'user message',
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            thought: true,
            text: 'thinking',
            thoughtSignature: 'sig',
          },
        ],
      },
    ]

    const result = stripSignaturesFromContents(input)

    expect(result).toHaveLength(2)
    expect(result[0]?.role).toBe('user')
    expect(result[1]?.role).toBe('model')
    expect(result[0]?.parts[0]).toEqual({ text: 'user message' })
  })

  it('should handle empty contents array', () => {
    const input: Content[] = []
    const result = stripSignaturesFromContents(input)
    expect(result).toEqual([])
  })

  it('should handle contents with no signatures', () => {
    const input: Content[] = [
      {
        role: 'user',
        parts: [{ text: 'hello' }],
      },
      {
        role: 'model',
        parts: [{ text: 'hi' }],
      },
    ]

    const result = stripSignaturesFromContents(input)

    expect(result).toHaveLength(2)
    expect(result[0]?.role).toBe('user')
    expect(result[1]?.role).toBe('model')
  })

  it('should handle nested contents structure', () => {
    const input: Content[] = [
      {
        role: 'user',
        parts: [{ text: 'question' }],
      },
      {
        role: 'model',
        parts: [
          {
            thought: true,
            text: 'analyzing',
            thoughtSignature: 'sig1',
          },
          {
            text: 'answer',
          },
        ],
      },
      {
        role: 'user',
        parts: [{ text: 'follow-up' }],
      },
    ]

    const result = stripSignaturesFromContents(input)

    expect(result).toHaveLength(3)
    expect(result[0]?.role).toBe('user')
    expect(result[1]?.role).toBe('model')
    expect(result[2]?.role).toBe('user')
    expect(result[1]?.parts).toHaveLength(2)
    expect(result[1]?.parts[0]).toEqual({
      thought: true,
      text: 'analyzing',
    })
  })
})
