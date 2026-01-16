import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RequestLogStore } from '../request-log-store'
import { assertNoThoughtSignatureString } from '../../utils/sanitize-for-logging'

describe('RequestLogStore Sanitization', () => {
  let store: RequestLogStore

  beforeEach(() => {
    store = new RequestLogStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  test('should sanitize thoughtSignature from logged requests', () => {
    const requestId = 'req-san-1'
    const sensitiveRequest = {
      messages: [
        { 
          role: 'user', 
          content: 'hello',
          thoughtSignature: 'secret_sig_123'
        }
      ]
    }

    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'anthropic',
      targetModel: 'claude-3-opus',
      targetEndpoint: 'https://api.anthropic.com/v1/messages',
      preTransformRequest: sensitiveRequest,
      postTransformRequest: sensitiveRequest,
      isStreaming: false,
    })

    const entry = store.getByRequestId(requestId)
    expect(entry).toBeDefined()
    
    // Check strings in DB
    expect(assertNoThoughtSignatureString(entry!.preTransformRequest)).toBe(true)
    expect(assertNoThoughtSignatureString(entry!.postTransformRequest)).toBe(true)
    
    // Check parsed objects
    const parsedPre = JSON.parse(entry!.preTransformRequest)
    expect(parsedPre.messages[0]).not.toHaveProperty('thoughtSignature')
  })

  test('should sanitize thought_signature from logged responses', () => {
    const requestId = 'req-san-2'
    
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

    const sensitiveResponse = {
      id: 'resp-1',
      choices: [{
        message: {
          content: 'response',
          thought_signature: 'secret_sig_456'
        }
      }]
    }

    store.logResponse({
      requestId,
      preTransformResponse: sensitiveResponse,
      postTransformResponse: sensitiveResponse,
      statusCode: 200,
      durationMs: 100,
    })

    const entry = store.getByRequestId(requestId)
    
    expect(assertNoThoughtSignatureString(entry!.preTransformResponse!)).toBe(true)
    expect(assertNoThoughtSignatureString(entry!.postTransformResponse!)).toBe(true)
  })

  test('should sanitize updates via updateLog', () => {
    const requestId = 'req-san-3'
    
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

    const sensitiveUpdate = {
      postTransformResponse: {
        raw: {
          thoughtSignature: 'secret_update_sig'
        }
      }
    }

    // @ts-expect-error - Testing implementation handling of object in partial update
    store.updateLog(requestId, sensitiveUpdate)

    const entry = store.getByRequestId(requestId)
    expect(assertNoThoughtSignatureString(entry!.postTransformResponse!)).toBe(true)
  })
})
