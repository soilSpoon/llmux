
import { describe, expect, it } from 'bun:test'
import { parseResponse } from '../response'
import type { AntigravityResponse } from '../types'

describe('Antigravity Response Parsing', () => {
  it('correctly maps thought signature from thinking blocks', () => {
    const mockResponse: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'Thinking process...',
                  thoughtSignature: 'sig_12345',
                  thought_signature: 'sig_12345'
                },
                {
                  text: 'Final answer'
                }
              ]
            },
            finishReason: 'STOP'
          }
        ]
      }
    }

    const result = parseResponse(mockResponse)
    
    expect(result.thinking).toBeDefined()
    expect(result.thinking).toHaveLength(1)
    expect(result.thinking![0].text).toBe('Thinking process...')
    expect(result.thinking![0].signature).toBe('sig_12345')
  })

  it('maps thought signature when provided with content parts', () => {
    const mockResponse: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: 'Response text',
                  thoughtSignature: 'sig_content_123',
                  thought_signature: 'sig_content_123'
                }
              ]
            },
            finishReason: 'STOP'
          }
        ]
      }
    }

    const result = parseResponse(mockResponse)
    
    // Check if the content part has the thoughtSignature
    const contentPart = result.content.find(p => p.type === 'text')
    expect(contentPart).toBeDefined()
    // @ts-ignore - thoughtSignature might not be in the type definition yet, but we're testing runtime behavior or added property
    expect(contentPart.thoughtSignature).toBe('sig_content_123')
  })
})
