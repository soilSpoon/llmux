import { expect } from 'bun:test'
import type { Provider } from '../../../src/providers/base'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../../src/types/unified'

/**
 * Validates that a provider request transforms correctly to/from UnifiedRequest
 * 
 * 1. transform(unifiedRequest) -> providerRequest
 * 2. parse(providerRequest) -> unifiedRequest (or roughly equivalent)
 */
export function expectRequestRoundTrip(
  provider: Provider,
  unifiedRequest: UnifiedRequest,
  expectedProviderRequest?: unknown
): unknown {
  // Transform unified -> provider
  const providerRequest = provider.transform(unifiedRequest)
  
  if (expectedProviderRequest) {
    expect(providerRequest).toEqual(expectedProviderRequest)
  }
  
  // Parse provider -> unified
  const parsedRequest = provider.parse(providerRequest)
  
  // Verify critical fields match
  // Note: We don't expect exact equality as some information might be lost/normalized
  expect(parsedRequest.messages).toHaveLength(unifiedRequest.messages.length)
  
  // Check message content
  unifiedRequest.messages.forEach((msg, i) => {
    expect(parsedRequest.messages[i].role).toBe(msg.role)
    const originalText = msg.parts.find(p => p.type === 'text')?.text
    const parsedText = parsedRequest.messages[i].parts.find(p => p.type === 'text')?.text
    
    if (originalText && parsedText) {
      expect(parsedText).toBe(originalText)
    }
  })
  
  return providerRequest
}

/**
 * Validates that a provider response transforms correctly to/from UnifiedResponse
 */
export function expectResponseRoundTrip(
  provider: Provider,
  unifiedResponse: UnifiedResponse,
  expectedProviderResponse?: unknown
): unknown {
  // Transform unified -> provider
  const providerResponse = provider.transformResponse(unifiedResponse)
  
  if (expectedProviderResponse) {
    expect(providerResponse).toEqual(expectedProviderResponse)
  }
  
  // Parse provider -> unified
  const parsedResponse = provider.parseResponse(providerResponse)
  
  // Verify critical fields match
  expect(parsedResponse.content).toHaveLength(unifiedResponse.content.length)
  
  const originalText = unifiedResponse.content.find(p => p.type === 'text')?.text
  const parsedText = parsedResponse.content.find(p => p.type === 'text')?.text
  
  if (originalText && parsedText) {
    expect(parsedText).toBe(originalText)
  }
  
  return providerResponse
}

/**
 * Collects stream chunks from a provider-specific stream
 * Note: This is a simulation since we can't easily mock real streams here
 */
export function collectStreamChunks(
  provider: Provider,
  providerChunks: string[]
): StreamChunk[] {
  if (!provider.parseStreamChunk) {
    throw new Error(`Provider ${provider.name} does not support stream parsing`)
  }

  const chunks: StreamChunk[] = []
  
  for (const chunkStr of providerChunks) {
    const chunk = provider.parseStreamChunk(chunkStr)
    if (chunk) {
      chunks.push(chunk)
    }
  }
  
  return chunks
}

/**
 * Merges stream chunks into a final UnifiedResponse
 * Useful for validating streaming implementation correctness
 */
export function mergeStreamChunksToResponse(chunks: StreamChunk[]): UnifiedResponse {
  let combinedText = ''
  let stopReason: UnifiedResponse['stopReason'] = null
  let usage = undefined
  
  for (const chunk of chunks) {
    if (chunk.type === 'content' && chunk.delta?.text) {
      combinedText += chunk.delta.text
    }
    
    if (chunk.stopReason) {
      stopReason = chunk.stopReason
    }
    
    if (chunk.usage) {
      usage = chunk.usage
    }
  }
  
  return {
    id: 'stream-combined',
    content: [{ type: 'text', text: combinedText }],
    stopReason,
    usage,
  }
}
