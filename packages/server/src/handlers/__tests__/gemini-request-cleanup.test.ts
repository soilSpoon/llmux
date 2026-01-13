import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as Core from '@llmux/core'
import { SignatureStore } from '../../stores/signature-store'
import { sanitizeRequestSignatures } from '../request-sanitizer'
import type { ThinkingContent, ThinkingPart } from '../types/thinking-types'

describe('Gemini Request Sanitization', () => {
  const signatureStore = new SignatureStore()

  afterEach(() => {
    mock.restore()
  })

  function mockGeminiFamily(): void {
    spyOn(Core, 'getModelFamily').mockImplementation((model: string) => {
      if (model.includes('gemini')) return 'gemini'
      if (model.includes('claude')) return 'claude'
      return 'openai'
    })
  }

  function getPartField(
    part: ThinkingPart | undefined,
    field: string,
  ): unknown {
    if (!part) {
      throw new Error('Part should not be undefined')
    }
    return part[field]
  }

  it('should strip thoughtSignature and thinkingMetadata from Gemini requests', () => {
    mockGeminiFamily()

    const inputContents: ThinkingContent[] = [
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'edit_file', args: {} },
            thoughtSignature: 'invalid-sig-1',
            thought_signature: 'invalid-sig-2',
            thinkingMetadata: { some: 'meta' },
          },
        ],
      },
    ]

    const result = sanitizeRequestSignatures({
      contents: inputContents,
      model: 'gemini-2.0-flash-thinking',
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-req-id',
    })

    const contents = result.contents
    expect(contents).toBeDefined()
    expect(contents?.length).toBeGreaterThan(0)

    const firstContent = contents?.[0]
    expect(firstContent?.parts).toBeDefined()
    expect(firstContent?.parts?.length).toBeGreaterThan(0)

    const part = firstContent?.parts?.[0]

    expect(getPartField(part, 'thoughtSignature')).toBeUndefined()
    expect(getPartField(part, 'thought_signature')).toBeUndefined()
    expect(getPartField(part, 'thinkingMetadata')).toBeUndefined()

    expect(part?.functionCall).toBeDefined()
    const functionCall = getPartField(part, 'functionCall')

    // Type checking using Record<string, unknown> instead of 'as any'
    expect(typeof functionCall).toBe('object')
    expect(functionCall).not.toBeNull()
    const fc = functionCall as Record<string, unknown>
    expect(fc.name).toBe('edit_file')
  })

  it('should preserve text parts while stripping signatures', () => {
    mockGeminiFamily()

    const inputContents: ThinkingContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Hello world' }],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Response text',
            thoughtSignature: 'sig-to-strip',
          },
        ],
      },
    ]

    const result = sanitizeRequestSignatures({
      contents: inputContents,
      model: 'gemini-2.0-flash',
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-preserve-text',
    })

    const contents = result.contents
    expect(contents?.length).toBe(2)

    const userPart = contents?.[0]?.parts?.[0]
    expect(userPart?.text).toBe('Hello world')

    const modelPart = contents?.[1]?.parts?.[0]
    expect(modelPart?.text).toBe('Response text')
    expect(getPartField(modelPart, 'thoughtSignature')).toBeUndefined()
  })

  it('should handle empty contents array', () => {
    mockGeminiFamily()

    const result = sanitizeRequestSignatures({
      contents: [],
      model: 'gemini-2.0-flash',
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-empty',
    })

    expect(result.contents).toEqual([])
    expect(result.strippedCount).toBe(0)
  })

  it('should handle undefined contents gracefully', () => {
    mockGeminiFamily()

    const result = sanitizeRequestSignatures({
      contents: undefined,
      model: 'gemini-2.0-flash',
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-undefined',
    })

    expect(result.contents).toBeUndefined()
    expect(result.strippedCount).toBe(0)
  })

  it('should strip multiple signature field variants', () => {
    mockGeminiFamily()

    const inputContents: ThinkingContent[] = [
      {
        role: 'model',
        parts: [
          {
            text: 'thinking output',
            thought: true,
            signature: 'sig-1',
            thoughtSignature: 'sig-2',
            thought_signature: 'sig-3',
          },
        ],
      },
    ]

    const result = sanitizeRequestSignatures({
      contents: inputContents,
      model: 'gemini-2.0-flash-thinking',
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-multiple-sigs',
    })

    const part = result.contents?.[0]?.parts?.[0]
    expect(getPartField(part, 'signature')).toBeUndefined()
    expect(getPartField(part, 'thoughtSignature')).toBeUndefined()
    expect(getPartField(part, 'thought_signature')).toBeUndefined()
    expect(part?.text).toBe('thinking output')
  })

  it('should handle null parts in array (edge case)', () => {
    mockGeminiFamily()

    // Assuming parts array might contain null/undefined due to bad upstream data,
    // though types say ThinkingPart[]. But runtime might be different.
    // However, ThinkingContent defines parts as ThinkingPart[].
    // Let's test empty part object.
    const inputContents: ThinkingContent[] = [
      {
        role: 'model',
        parts: [{}],
      },
    ]

    const result = sanitizeRequestSignatures({
      contents: inputContents,
      model: 'gemini-2.0-flash-thinking',
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-empty-part',
    })

    // Empty part should be filtered out
    expect(result.contents?.[0]?.parts?.length).toBe(0)
  })
})
