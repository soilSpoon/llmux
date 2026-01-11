
import { describe, expect, it, mock } from 'bun:test'
import { SignatureStore } from '../../stores/signature-store'
import { sanitizeRequestSignatures } from '../request-sanitizer'
import { type Content } from '../thinking-utils'

// Mock the logger and core utils
mock.module('@llmux/core', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
  }),
  getModelFamily: (model: string) => {
    if (model.includes('gemini')) return 'gemini'
    if (model.includes('claude')) return 'claude'
    return 'unknown'
  }
}))

describe('Gemini Request Sanitization (Bug Fix)', () => {
  const signatureStore = new SignatureStore()

  it('should strip thoughtSignature and thinkingMetadata from Gemini requests', () => {
    // Input: A request body with invalid fields that caused 400 errors
    const inputContents: Content[] = [
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'edit_file', args: {} },
            thoughtSignature: 'invalid-sig-1',
            thought_signature: 'invalid-sig-2',
            thinkingMetadata: { some: 'meta' }
          }
        ]
      }
    ] as any

    const result = sanitizeRequestSignatures({
      contents: inputContents,
      model: 'gemini-2.0-flash-thinking', // Triggers 'gemini-cache' strategy
      projectId: 'test-project',
      signatureStore,
      reqId: 'test-req-id'
    })

    const contents = result.contents
    if (!contents || contents.length === 0) {
      throw new Error('Contents should not be empty')
    }

    const firstContent = contents[0]
    if (!firstContent?.parts?.[0]) {
      throw new Error('First content should have parts')
    }
    const part = firstContent.parts[0] as Record<string, unknown>
    
    // Assert: Invalid fields should be removed
    // Currently (RED state), these expectations will fail because the code passed them through
    expect(part.thoughtSignature).toBeUndefined()
    expect(part.thought_signature).toBeUndefined()
    expect(part.thinkingMetadata).toBeUndefined()
    
    // Assert: Valid fields should remain
    expect(part.functionCall).toBeDefined()
    expect(part.functionCall.name).toBe('edit_file')
  })
})
