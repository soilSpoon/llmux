import { describe, it, expect } from 'bun:test'
import {
  stripThoughtSignatures,
  stripSignaturesFromContents,
  stripSignaturesFromMessages,
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
  it('should strip entire thinking blocks with signatures (signatures are not portable)', () => {
    const input = [
      {
        thought: true,
        text: 'Let me think...',
        thoughtSignature: 'ErADCq0DAXLI2nx...',
      } satisfies ThinkingPart,
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(1)
    // When signature is present, thought flag is stripped along with signature
    expect(result[0]).toHaveProperty('text', 'Let me think...')
    expect(result[0]).not.toHaveProperty('thought')
    expect(result[0]).not.toHaveProperty('thoughtSignature')
  })

  it('should remove thinking block when no targetModel specified', () => {
    const input = [
      {
        thought: true,
        text: 'Let me think...',
        thoughtSignature: 'ErADCq0DAXLI2nx...',
      } satisfies ThinkingPart,
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveProperty('text', 'Let me think...')
    expect(result[0]).not.toHaveProperty('thought')
    expect(result[0]).not.toHaveProperty('thoughtSignature')
  })

  it('should leave parts without signature unchanged', () => {
    const input: Part[] = [
      { text: 'The answer is 4' },
      { thought: true, text: 'thinking...' }, // No signature, so it stays
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ text: 'The answer is 4' })
    expect(result[1]).toEqual({ thought: true, text: 'thinking...' })
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
        thought: true, // No signature
        text: 'Second thought',
      },
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(3)
    // First one stripped of thought prop
    expect(result[0]).toEqual({
      text: 'First thought',
    })
    expect(result[0]).not.toHaveProperty('thought')
    
    // Regular text unchanged
    expect(result[1]).toEqual({
      text: 'Regular response',
    })

    // Unsigned thinking unchanged
    expect(result[2]).toEqual({
      thought: true,
      text: 'Second thought',
    })
  })

  it('should handle empty array', () => {
    const input: Part[] = []
    const result = stripThoughtSignatures(input)
    expect(result).toEqual([])
  })

  it('should preserve other properties in parts (but strip thought flag)', () => {
    const input = [
      {
        thought: true,
        text: 'thinking',
        thoughtSignature: 'sig',
        customProp: 'value',
      },
    ]

    const result = stripThoughtSignatures(input)

    expect(result[0]).toHaveProperty('text', 'thinking')
    expect(result[0]).not.toHaveProperty('thoughtSignature')
    expect(result[0]).not.toHaveProperty('thought')
  })

  it('should preserve functionCall parts and replace signature with sentinel', () => {
    const input = [
      {
        functionCall: {
          name: 'tool',
          args: {},
        },
        thoughtSignature: 'sig',
      },
    ]

    const result = stripThoughtSignatures(input)

    expect(result).toHaveLength(1)
    expect((result[0] as any).functionCall).toBeDefined()
    expect(result[0]).toHaveProperty('thoughtSignature', 'skip_thought_signature_validator')
  })
})

type Content = {
  role: string
  parts: Part[]
}

describe('stripSignaturesFromContents', () => {
  it('should remove thinking attributes from signed blocks in contents array', () => {
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
    // Converted to text part
    expect(result[0]?.parts[0]).toEqual({
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
    // Model part stripped
    expect(result[1]?.parts[0]).toEqual({ text: 'thinking' })
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
})

type Message = {
  role: string
  content: Array<{ type?: string; signature?: string; thinking?: string; text?: string }> | string
}

describe('stripSignaturesFromMessages', () => {
  it('should convert thinking blocks with signature to text blocks', () => {
    const input: Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me think...',
            signature: 'invalid-cross-model-signature',
          },
          {
            type: 'text',
            text: 'response',
          },
        ],
      },
    ]

    const result = stripSignaturesFromMessages(input)

    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('assistant')
    const content = result[0]?.content as any[]
    expect(content).toHaveLength(2)
    // Thinking block converted to text block
    expect(content[0].type).toBe('text')
    expect(content[0].text).toBe('Let me think...')
    expect(content[0]).not.toHaveProperty('signature')
    expect(content[0]).not.toHaveProperty('thinking')
  })

  it('should preserve string content unchanged', () => {
    const input: Message[] = [
      {
        role: 'user',
        content: 'Hello',
      },
    ]

    const result = stripSignaturesFromMessages(input)

    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe('Hello')
  })

  it('should preserve blocks without signature', () => {
    const input: Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Thinking without signature',
          },
          {
            type: 'text',
            text: 'response',
          },
        ],
      },
    ]

    const result = stripSignaturesFromMessages(input)

    const content = result[0]?.content as any[]
    expect(content[0].type).toBe('thinking')
    expect(content[0].thinking).toBe('Thinking without signature')
  })
})
