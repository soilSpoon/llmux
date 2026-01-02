import { type ProviderName, transformResponse } from '@llmux/core'

export interface GeminiResponseShape {
  candidates?: Array<{
    content?: { parts?: Array<Record<string, unknown>> }
    finishReason?: string
  }>
  usageMetadata?: Record<string, unknown>
}

/**
 * Accumulates a Gemini-style SSE stream into a single JSON response object.
 * This is used when a client requests a non-streaming response but the upstream only supports streaming (or we force it).
 */
export async function accumulateGeminiResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<GeminiResponseShape | null> {
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResponse: GeminiResponseShape | null = null
  let accumulatedParts: Array<Record<string, unknown>> = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
      try {
        const chunk = JSON.parse(line.slice(6))
        const actual = chunk.response || chunk
        if (!finalResponse) {
          finalResponse = actual as GeminiResponseShape
          accumulatedParts = actual.candidates?.[0]?.content?.parts || []
        } else {
          accumulatedParts.push(...(actual.candidates?.[0]?.content?.parts || []))
          if (actual.candidates?.[0]?.finishReason && finalResponse.candidates?.[0]) {
            finalResponse.candidates[0].finishReason = actual.candidates[0].finishReason
          }
          if (actual.usageMetadata) finalResponse.usageMetadata = actual.usageMetadata
        }
      } catch {}
    }
  }

  if (finalResponse && accumulatedParts.length && finalResponse.candidates?.[0]?.content) {
    finalResponse.candidates[0].content.parts = accumulatedParts
  }

  return finalResponse
}

export function transformGeminiSseResponse(
  finalResponse: GeminiResponseShape,
  currentProvider: ProviderName,
  targetFormat: ProviderName
): unknown {
  return transformResponse({ response: finalResponse }, { from: currentProvider, to: targetFormat })
}
