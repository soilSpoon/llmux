
import { describe, expect, it } from 'bun:test'
import { RequestLogStore } from '../request-log-store'

describe('RequestLogStore Signature Stripping', () => {
  it('should strip thoughtSignature from logged requests', () => {
    const store = new RequestLogStore(':memory:')
    const requestId = 'req-123'
    
    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'antigravity',
      targetModel: 'gemini-2.0-flash-thinking',
      targetEndpoint: '/generateContent',
      preTransformRequest: {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'I need to think...',
                thoughtSignature: 'secret-signature-123'
              }
            ]
          }
        ]
      },
      postTransformRequest: {
        contents: [
          {
            role: 'model',
            parts: [
              {
                thought: true,
                text: 'I need to think...',
                thoughtSignature: 'secret-signature-456'
              }
            ]
          }
        ]
      },
      isStreaming: false
    })
    
    const entry = store.getByRequestId(requestId)
    expect(entry).toBeDefined()
    
    const preRequest = JSON.parse(entry!.preTransformRequest)
    const postRequest = JSON.parse(entry!.postTransformRequest)
    
    // Check Pre-transform (Unified format)
    expect(preRequest.messages[0].content[0].thoughtSignature).toBe('[REDACTED]')
    expect(preRequest.messages[0].content[0].thinking).toBe('I need to think...')
    
    // Check Post-transform (Gemini format)
    expect(postRequest.contents[0].parts[0].thoughtSignature).toBe('[REDACTED]')
    expect(postRequest.contents[0].parts[0].text).toBe('I need to think...')
    
    store.close()
  })

  it('should strip thought_signature (snake_case) from logged requests', () => {
    const store = new RequestLogStore(':memory:')
    const requestId = 'req-snake'
    
    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'antigravity',
      targetModel: 'gemini-2.0-flash-thinking',
      targetEndpoint: '/generateContent',
      preTransformRequest: {},
      postTransformRequest: {
        contents: [
          {
            parts: [
              {
                thought_signature: 'secret-snake-signature'
              }
            ]
          }
        ]
      },
      isStreaming: false
    })
    
    const entry = store.getByRequestId(requestId)
    expect(entry).toBeDefined()
    
    const postRequest = JSON.parse(entry!.postTransformRequest)
    expect(postRequest.contents[0].parts[0].thought_signature).toBe('[REDACTED]')
    
    store.close()
  })

  it('should strip signatures when updating logs via updateLog', () => {
    const store = new RequestLogStore(':memory:')
    const requestId = 'req-update'
    
    store.logRequest({
      requestId,
      sourceProvider: 'openai',
      sourceModel: 'gpt-4',
      sourceEndpoint: '/v1/chat/completions',
      targetProvider: 'antigravity',
      targetModel: 'gemini-2.0-flash-thinking',
      targetEndpoint: '/generateContent',
      preTransformRequest: {},
      postTransformRequest: {},
      isStreaming: false
    })
    
    // Pass object even though type says string (runtime supports it)
    store.updateLog(requestId, {
      postTransformResponse: {
        contents: [
          {
            parts: [
              {
                text: 'Update response',
                thoughtSignature: 'secret-update-signature'
              }
            ]
          }
        ]
      } as unknown as string
    })
    
    const entry = store.getByRequestId(requestId)
    expect(entry).toBeDefined()
    
    // The store stringifies the object
    const postResponse = JSON.parse(entry!.postTransformResponse!)
    expect(postResponse.contents[0].parts[0].thoughtSignature).toBe('[REDACTED]')
    
    store.close()
  })
})
