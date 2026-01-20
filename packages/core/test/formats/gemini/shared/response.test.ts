import { describe, expect, it } from 'bun:test'
import { parseGeminiResponse, type GeminiResponse } from '../../../../src/formats/gemini/shared/response'

describe('Shared Gemini Response Parser', () => {
  it('should parse simple text response', () => {
    const raw: GeminiResponse = {
        candidates: [{
            content: { parts: [{ text: 'Hello' }] },
            finishReason: 'STOP'
        }],
        usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15
        }
    }

    const res = parseGeminiResponse(raw)
    expect(res.content[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(res.stopReason).toBe('end_turn')
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it('should parse tool call (decoding name)', () => {
    const raw: GeminiResponse = {
        candidates: [{
            content: { parts: [{ 
                // 'Encoded' base64url is 'RW5jb2RlZA'
                functionCall: { name: 'tRW5jb2RlZA', args: { foo: 'bar' } } 
            }] }
        }]
    }
    
    const res = parseGeminiResponse(raw)
    const firstPart = res.content[0]
    if (!firstPart) throw new Error('Expected content to have at least one element')
    expect(firstPart.type).toBe('tool_call')
    if (firstPart.type !== 'tool_call' || !firstPart.toolCall) {
      throw new Error('Expected first part to be a tool_call')
    }
    expect(firstPart.toolCall.name).toBe('Encoded')
    expect(firstPart.toolCall.arguments).toEqual({ foo: 'bar' })
  })
})
