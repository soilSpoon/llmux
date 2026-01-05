import { describe, expect, it } from 'bun:test'
import { parse as parseGemini } from './providers/gemini/request'
import { parseStreamChunk } from './providers/gemini/streaming'
import type { GeminiRequest } from './providers/gemini/types'

describe('Gemini 3 Flash thoughtSignature Verification', () => {
  it('should preserve thoughtSignature when parsing Gemini request with function call', () => {
    // Simulated Gemini 3 Flash request with thoughtSignature attached to functionCall
    const request: GeminiRequest = {
      contents: [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'Read',
                args: { path: '/tmp/test' },
                id: 'call_123',
              },
              thoughtSignature: 'sig_abc123',
            },
          ],
        },
      ],
    }

    const unified = parseGemini(request)

    // Check if thinking was attached to tool call
    const firstMessage = unified.messages[0]
    if (!firstMessage) throw new Error('Expected at least one message')

    const toolCallPart = firstMessage.parts.find((p) => p.type === 'tool_call')
    expect(toolCallPart).toBeDefined()
    expect(toolCallPart?.toolCall?.name).toBe('Read')
    expect(toolCallPart?.thoughtSignature).toBe('sig_abc123')
  })

  it('should preserve thoughtSignature when parsing Gemini stream chunk', () => {
    const chunkStr = `data: {
      "candidates": [{
        "content": {
          "role": "model",
          "parts": [{
            "functionCall": { "name": "Read", "args": {} },
            "thoughtSignature": "sig_stream_123"
          }]
        },
        "finishReason": "STOP"
      }]
    }`

    const unifiedChunk = parseStreamChunk(chunkStr)

    expect(unifiedChunk).not.toBeNull()
    if (unifiedChunk) {
      expect(unifiedChunk.type).toBe('tool_call')
      expect(unifiedChunk.delta?.thoughtSignature).toBe('sig_stream_123')
    }
  })
})
