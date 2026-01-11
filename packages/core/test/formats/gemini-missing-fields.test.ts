
import { describe, expect, test } from 'bun:test'
import { GoogleGeminiFormat } from '../../src/formats/google-gemini'
import type { GeminiResponse } from '../../src/formats/google-gemini/types'
import type { UnifiedResponse } from '../../src/types/unified'

describe('Google Gemini Format - Missing Fields', () => {
  const ctx = { provider: 'gemini' as const, model: 'gemini-1.5-pro' }

  test('should round-trip createTime and responseId', () => {
    const wireResponse: GeminiResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Hello' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
      modelVersion: 'gemini-1.5-pro',
      createTime: '2024-01-01T00:00:00Z',
      responseId: 'resp_12345',
    }

    // 1. Parse Wire -> Unified
    const unified = GoogleGeminiFormat.parseResponse(wireResponse)
    
    // Check if Unified preserved the fields
    expect(unified.id).toBe('resp_12345')
    expect(unified.metadata?.createTime).toBe('2024-01-01T00:00:00Z') // Assuming we map it to metadata

    // 2. Build Unified -> Wire
    const built = GoogleGeminiFormat.buildWireResponse(unified, ctx) as GeminiResponse

    // Check if Wire has the fields back
    expect(built.responseId).toBe('resp_12345')
    expect(built.createTime).toBe('2024-01-01T00:00:00Z')
  })

  test('should NOT include id in functionCall output', () => {
    const unified: UnifiedResponse = {
      id: 'resp_123',
      content: [{
        type: 'tool_call',
        toolCall: {
          id: 'call_123',
          name: 'get_weather',
          arguments: { city: 'Seoul' }
        }
      }],
      stopReason: 'tool_use'
    }

    const built = GoogleGeminiFormat.buildWireResponse(unified, ctx) as GeminiResponse
    const part = built.candidates?.[0]?.content?.parts?.[0]
    
    if (part && 'functionCall' in part && part.functionCall) {
      expect(part.functionCall.name).toBe('get_weather')
      expect('id' in part.functionCall).toBe(false)
    } else {
      throw new Error('Expected functionCall to be present in Gemini response part')
    }
  })
})
