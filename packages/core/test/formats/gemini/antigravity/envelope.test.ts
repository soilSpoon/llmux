import { describe, expect, it } from 'bun:test'
import { buildAntigravityEnvelope } from '../../../../src/formats/gemini/antigravity/envelope'
import type { AntigravityRequestPayload } from '../../../../src/formats/gemini/antigravity/types'

describe('buildAntigravityEnvelope', () => {
  const dummyPayload: AntigravityRequestPayload = {
    contents: []
  }

  it('should build a valid envelope with all required fields', () => {
    const opts = {
      project: 'test-project',
      location: 'us-central1',
      model: 'gemini-pro',
      userAgent: 'test-agent'
    }

    const envelope = buildAntigravityEnvelope(dummyPayload, opts)

    expect(envelope.project).toBe('test-project')
    expect(envelope.location).toBe('us-central1')
    expect(envelope.model).toBe('gemini-pro')
    expect(envelope.request).toBe(dummyPayload)
    expect(envelope.userAgent).toBe('test-agent')
    expect(envelope.requestId).toBeDefined() // Should be auto-generated
  })

  it('should create new requestId if not provided', () => {
    const opts = {
      project: 'p',
      location: 'l',
      model: 'm'
    }
    const env1 = buildAntigravityEnvelope(dummyPayload, opts)
    const env2 = buildAntigravityEnvelope(dummyPayload, opts)

    expect(env1.requestId).not.toBe(env2.requestId)
  })

  it('should use provided requestId', () => {
    const opts = {
      project: 'p',
      location: 'l',
      model: 'm',
      requestId: 'custom-id'
    }
    const env = buildAntigravityEnvelope(dummyPayload, opts)
    expect(env.requestId).toBe('custom-id')
  })

  it('should throw error if project ID is missing', () => {
    const opts = {
      project: '',
      location: 'l',
      model: 'm'
    }
    expect(() => buildAntigravityEnvelope(dummyPayload, opts)).toThrow('Project ID is required')
  })
})
