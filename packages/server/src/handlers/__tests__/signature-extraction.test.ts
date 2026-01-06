import { describe, expect, it } from 'bun:test'
import {
  getSignatureFromPart,
  getSignatureFromBlock,
  stripSignatureFromPart,
  stripSignatureFromBlock,
  type Part,
  type Block,
} from '../thinking-utils'

describe('getSignatureFromPart', () => {
  it('returns thoughtSignature when present', () => {
    const part: Part = { thoughtSignature: 'sig-thought' }
    expect(getSignatureFromPart(part)).toBe('sig-thought')
  })

  it('returns thought_signature when no thoughtSignature', () => {
    const part: Part = { thought_signature: 'sig-underscore' }
    expect(getSignatureFromPart(part)).toBe('sig-underscore')
  })

  it('returns signature as last fallback', () => {
    const part: Part = { signature: 'sig-plain' }
    expect(getSignatureFromPart(part)).toBe('sig-plain')
  })

  it('returns undefined when no signature fields', () => {
    const part: Part = { text: 'hello' }
    expect(getSignatureFromPart(part)).toBeUndefined()
  })

  it('thoughtSignature takes precedence over thought_signature', () => {
    const part: Part = {
      thoughtSignature: 'camel',
      thought_signature: 'snake',
    }
    expect(getSignatureFromPart(part)).toBe('camel')
  })

  it('thoughtSignature takes precedence over signature', () => {
    const part: Part = {
      thoughtSignature: 'camel',
      signature: 'plain',
    }
    expect(getSignatureFromPart(part)).toBe('camel')
  })

  it('thought_signature takes precedence over signature', () => {
    const part: Part = {
      thought_signature: 'snake',
      signature: 'plain',
    }
    expect(getSignatureFromPart(part)).toBe('snake')
  })

  it('returns correct signature when all three fields present', () => {
    const part: Part = {
      thoughtSignature: 'camel',
      thought_signature: 'snake',
      signature: 'plain',
    }
    expect(getSignatureFromPart(part)).toBe('camel')
  })

  it('empty string signature is falsy - returns undefined', () => {
    const part: Part = { thoughtSignature: '' }
    expect(getSignatureFromPart(part)).toBeUndefined()
  })

  it('empty string in higher priority field falls through to next', () => {
    const part: Part = {
      thoughtSignature: '',
      thought_signature: 'snake',
    }
    expect(getSignatureFromPart(part)).toBe('snake')
  })
})

describe('getSignatureFromBlock', () => {
  it('returns signature when present', () => {
    const block: Block = { signature: 'sig-plain' }
    expect(getSignatureFromBlock(block)).toBe('sig-plain')
  })

  it('returns thoughtSignature when no signature', () => {
    const block: Block = { thoughtSignature: 'sig-camel' }
    expect(getSignatureFromBlock(block)).toBe('sig-camel')
  })

  it('returns thought_signature as last fallback', () => {
    const block: Block = { thought_signature: 'sig-underscore' }
    expect(getSignatureFromBlock(block)).toBe('sig-underscore')
  })

  it('returns undefined when no signature fields', () => {
    const block: Block = { type: 'text', text: 'hello' }
    expect(getSignatureFromBlock(block)).toBeUndefined()
  })

  it('signature takes precedence over thoughtSignature', () => {
    const block: Block = {
      signature: 'plain',
      thoughtSignature: 'camel',
    }
    expect(getSignatureFromBlock(block)).toBe('plain')
  })

  it('signature takes precedence over thought_signature', () => {
    const block: Block = {
      signature: 'plain',
      thought_signature: 'snake',
    }
    expect(getSignatureFromBlock(block)).toBe('plain')
  })

  it('thoughtSignature takes precedence over thought_signature', () => {
    const block: Block = {
      thoughtSignature: 'camel',
      thought_signature: 'snake',
    }
    expect(getSignatureFromBlock(block)).toBe('camel')
  })

  it('returns correct signature when all three fields present', () => {
    const block: Block = {
      signature: 'plain',
      thoughtSignature: 'camel',
      thought_signature: 'snake',
    }
    expect(getSignatureFromBlock(block)).toBe('plain')
  })

  it('empty string signature is falsy - returns undefined', () => {
    const block: Block = { signature: '' }
    expect(getSignatureFromBlock(block)).toBeUndefined()
  })

  it('empty string in higher priority field falls through to next', () => {
    const block: Block = {
      signature: '',
      thoughtSignature: 'camel',
    }
    expect(getSignatureFromBlock(block)).toBe('camel')
  })
})

describe('stripSignatureFromPart', () => {
  it('removes thoughtSignature field', () => {
    const part: Part = { text: 'hello', thoughtSignature: 'sig' }
    const result = stripSignatureFromPart(part)
    expect(result).toEqual({ text: 'hello' })
    expect('thoughtSignature' in result).toBe(false)
  })

  it('removes thought_signature field', () => {
    const part: Part = { text: 'hello', thought_signature: 'sig' }
    const result = stripSignatureFromPart(part)
    expect(result).toEqual({ text: 'hello' })
    expect('thought_signature' in result).toBe(false)
  })

  it('removes signature field', () => {
    const part: Part = { text: 'hello', signature: 'sig' }
    const result = stripSignatureFromPart(part)
    expect(result).toEqual({ text: 'hello' })
    expect('signature' in result).toBe(false)
  })

  it('removes all signature fields at once', () => {
    const part: Part = {
      text: 'hello',
      thought: true,
      thoughtSignature: 'camel',
      thought_signature: 'snake',
      signature: 'plain',
    }
    const result = stripSignatureFromPart(part)
    expect(result).toEqual({ text: 'hello', thought: true })
    expect('thoughtSignature' in result).toBe(false)
    expect('thought_signature' in result).toBe(false)
    expect('signature' in result).toBe(false)
  })

  it('preserves other fields', () => {
    const part: Part = {
      text: 'thinking text',
      thought: true,
      type: 'thinking',
      thoughtSignature: 'sig',
    }
    const result = stripSignatureFromPart(part)
    expect(result.text).toBe('thinking text')
    expect(result.thought).toBe(true)
    expect(result.type).toBe('thinking')
  })

  it('returns copy without signature when no signatures present', () => {
    const part: Part = { text: 'hello' }
    const result = stripSignatureFromPart(part)
    expect(result).toEqual({ text: 'hello' })
  })
})

describe('stripSignatureFromBlock', () => {
  it('removes signature field', () => {
    const block: Block = { type: 'thinking', thinking: 'text', signature: 'sig' }
    const result = stripSignatureFromBlock(block)
    expect(result).toEqual({ type: 'thinking', thinking: 'text' })
    expect('signature' in result).toBe(false)
  })

  it('removes thoughtSignature field', () => {
    const block: Block = { type: 'thinking', thoughtSignature: 'sig' }
    const result = stripSignatureFromBlock(block)
    expect(result).toEqual({ type: 'thinking' })
    expect('thoughtSignature' in result).toBe(false)
  })

  it('removes thought_signature field', () => {
    const block: Block = { type: 'thinking', thought_signature: 'sig' }
    const result = stripSignatureFromBlock(block)
    expect(result).toEqual({ type: 'thinking' })
    expect('thought_signature' in result).toBe(false)
  })

  it('removes all signature fields at once', () => {
    const block: Block = {
      type: 'thinking',
      thinking: 'deep thoughts',
      signature: 'plain',
      thoughtSignature: 'camel',
      thought_signature: 'snake',
    }
    const result = stripSignatureFromBlock(block)
    expect(result).toEqual({ type: 'thinking', thinking: 'deep thoughts' })
    expect('signature' in result).toBe(false)
    expect('thoughtSignature' in result).toBe(false)
    expect('thought_signature' in result).toBe(false)
  })

  it('preserves other fields', () => {
    const block: Block = {
      type: 'thinking',
      text: 'visible text',
      thinking: 'internal thinking',
      signature: 'sig',
    }
    const result = stripSignatureFromBlock(block)
    expect(result.type).toBe('thinking')
    expect(result.text).toBe('visible text')
    expect(result.thinking).toBe('internal thinking')
  })

  it('returns copy without signature when no signatures present', () => {
    const block: Block = { type: 'text', text: 'hello' }
    const result = stripSignatureFromBlock(block)
    expect(result).toEqual({ type: 'text', text: 'hello' })
  })
})
