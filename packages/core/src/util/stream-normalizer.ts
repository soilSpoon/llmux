import type { StreamChunk } from '../types'

/**
 * State for normalizing streaming event order.
 * Ensures that reasoning-end always comes before text-start.
 */
export interface StreamingState {
  hasThinkingStarted: boolean
  hasThinkingEnded: boolean
  hasTextStarted: boolean
}

/**
 * Normalizes streaming event order to ensure consistency across providers.
 *
 * Specifically enforces:
 * 1. reasoning-end must happen before text-start
 * 2. If text starts while thinking is ongoing, insert a synthetic thinking-end
 *
 * @param chunk The current stream chunk
 * @param state The mutable state object for this stream
 * @returns Array of normalized chunks (may include synthetic events)
 */
export function normalizeStreamingOrder(chunk: StreamChunk, state: StreamingState): StreamChunk[] {
  // Initialize result array
  const result: StreamChunk[] = []

  // Update state based on current chunk type
  if (chunk.type === 'thinking-start') {
    state.hasThinkingStarted = true
  } else if (chunk.type === 'thinking-end') {
    state.hasThinkingEnded = true
  } else if (chunk.type === 'text-delta') {
    // CRITICAL: If text starts but thinking hasn't ended properly, force it to end
    if (state.hasThinkingStarted && !state.hasThinkingEnded) {
      // Create synthetic thinking-end chunk
      const syntheticEnd: StreamChunk = {
        type: 'thinking-end',
        id: chunk.id,
        blockIndex: chunk.blockIndex,
        // Inherit other properties if available
        model: chunk.model,
      }

      result.push(syntheticEnd)
      state.hasThinkingEnded = true
    }

    state.hasTextStarted = true
  }

  // Add the original chunk
  result.push(chunk)

  return result
}
