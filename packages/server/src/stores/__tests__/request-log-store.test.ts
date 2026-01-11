import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RequestLogStore } from '../request-log-store'

describe('RequestLogStore', () => {
  let store: RequestLogStore

  beforeEach(() => {
    store = new RequestLogStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  test('should log request and retrieve it', () => {
    const requestId = 'test-req-001'

    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'anthropic',
      targetModel: 'claude-3-opus',
      targetEndpoint: 'https://api.anthropic.com/v1/messages',
      preTransformRequest: { messages: [{ role: 'user', content: 'Hello' }] },
      postTransformRequest: { messages: [{ role: 'user', content: 'Hello' }], model: 'claude-3-opus' },
      isStreaming: false,
    })

    const entry = store.getByRequestId(requestId)
    expect(entry).toBeDefined()
    expect(entry?.requestId).toBe(requestId)
    expect(entry?.sourceProvider).toBe('openai')
    expect(entry?.sourceModel).toBe('gpt-4')
    expect(entry?.targetProvider).toBe('anthropic')
    expect(entry?.targetModel).toBe('claude-3-opus')
    expect(entry?.isStreaming).toBe(false)

    const preReq = JSON.parse(entry?.preTransformRequest || '{}')
    expect(preReq.messages).toHaveLength(1)
  })

  test('should log response and update entry', () => {
    const requestId = 'test-req-002'

    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'anthropic',
      targetModel: 'claude-3-opus',
      targetEndpoint: 'https://api.anthropic.com/v1/messages',
      preTransformRequest: { messages: [] },
      postTransformRequest: { messages: [] },
      isStreaming: true,
    })

    store.logResponse({
      requestId,
      preTransformResponse: { id: 'resp-1', content: 'Hello!' },
      postTransformResponse: { choices: [{ message: { content: 'Hello!' } }] },
      statusCode: 200,
      durationMs: 1234,
    })

    const entry = store.getByRequestId(requestId)
    expect(entry?.statusCode).toBe(200)
    expect(entry?.durationMs).toBe(1234)
    expect(entry?.preTransformResponse).toContain('resp-1')
    expect(entry?.postTransformResponse).toContain('Hello!')
    expect(entry?.isStreaming).toBe(true)
  })

  test('should log error message', () => {
    const requestId = 'test-req-003'

    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'anthropic',
      targetModel: 'claude-3-opus',
      targetEndpoint: 'https://api.anthropic.com/v1/messages',
      preTransformRequest: {},
      postTransformRequest: {},
      isStreaming: false,
    })

    store.logResponse({
      requestId,
      preTransformResponse: { error: 'Rate limited' },
      postTransformResponse: { error: { message: 'Rate limited' } },
      statusCode: 429,
      durationMs: 100,
      errorMessage: 'Too Many Requests',
    })

    const entry = store.getByRequestId(requestId)
    expect(entry?.statusCode).toBe(429)
    expect(entry?.errorMessage).toBe('Too Many Requests')
  })

  test('should get recent entries', () => {
    for (let i = 0; i < 5; i++) {
      store.logRequest({
        requestId: `req-${i}`,
        sourceProvider: 'openai',
        sourceModel: 'gpt-4',
        sourceEndpoint: '/v1/chat/completions',
        targetProvider: 'anthropic',
        targetModel: 'claude-3-opus',
        targetEndpoint: 'https://api.anthropic.com/v1/messages',
        preTransformRequest: { index: i },
        postTransformRequest: { index: i },
        isStreaming: false,
      })
    }

    const recent = store.getRecent(3)
    expect(recent).toHaveLength(3)
    expect(recent[0]?.requestId).toBe('req-4')
    expect(recent[2]?.requestId).toBe('req-2')
  })

  test('should return null for non-existent request', () => {
    const entry = store.getByRequestId('non-existent')
    expect(entry).toBeNull()
  })

  test('should handle JSON stringify errors gracefully', () => {
    const requestId = 'test-circular'

    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'anthropic',
      targetModel: 'claude-3-opus',
      targetEndpoint: 'https://api.anthropic.com/v1/messages',
      preTransformRequest: circular,
      postTransformRequest: { ok: true },
      isStreaming: false,
    })

    const entry = store.getByRequestId(requestId)
    expect(entry).toBeDefined()
    expect(entry?.preTransformRequest).toContain('object Object')
  })
})
