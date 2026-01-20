/**
 * Stream Normalizer
 *
 * Ensures consistent ordering of streaming events, particularly for thinking models
 * where thinking-end must come before text-delta.
 */

import type { StreamChunk } from '../types/unified'

/**
 * State for tracking streaming order normalization
 */
export interface StreamingState {
  hasThinkingStarted: boolean
  hasThinkingEnded: boolean
  hasTextStarted: boolean
}

/**
 * Result of normalizing streaming order
 */
export interface NormalizeResult {
  events: StreamChunk[]
  newState: StreamingState
}

/**
 * Normalizes the order of streaming events to ensure correct sequencing.
 *
 * Key guarantees:
 * - thinking-start always comes before thinking-delta
 * - thinking-end always comes before text-delta
 * - Events are reordered if necessary to maintain these invariants
 *
 * @param chunks - Array of stream chunks to normalize
 * @param state - Current streaming state
 * @returns Normalized events and updated state
 */
export function normalizeStreamingOrder(
  chunks: StreamChunk[],
  state: StreamingState
): NormalizeResult {
  const newState = { ...state }
  const events: StreamChunk[] = []
  let pendingThinkingEnd: StreamChunk | null = null

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'thinking-start':
        newState.hasThinkingStarted = true
        events.push(chunk)
        break

      case 'thinking-delta':
        // If thinking hasn't started yet, inject a thinking-start
        if (!newState.hasThinkingStarted) {
          events.push({ type: 'thinking-start' })
          newState.hasThinkingStarted = true
        }
        events.push(chunk)
        break

      case 'thinking-end':
        newState.hasThinkingEnded = true
        // Don't emit yet - we may need to reorder
        pendingThinkingEnd = chunk
        break

      case 'text-delta':
        // Before first text-delta, ensure thinking-end is emitted if thinking started
        if (!newState.hasTextStarted) {
          if (newState.hasThinkingStarted && !newState.hasThinkingEnded) {
            // Force emit thinking-end before first text
            const endChunk: StreamChunk = { type: 'thinking-end' }
            if (chunk.id) endChunk.id = chunk.id

            // console.log('Injecting thinking-end', { pending: !!pendingThinkingEnd, chunkId: chunk.id })
            events.push(pendingThinkingEnd ?? endChunk)
            newState.hasThinkingEnded = true
            pendingThinkingEnd = null
          } else if (pendingThinkingEnd) {
            events.push(pendingThinkingEnd)
            pendingThinkingEnd = null
          }
          newState.hasTextStarted = true
        }
        events.push(chunk)
        break

      default:
        // For any other event, emit pending thinking-end first if present
        if (pendingThinkingEnd) {
          events.push(pendingThinkingEnd)
          pendingThinkingEnd = null
        }
        events.push(chunk)
        break
    }
  }

  // Emit any remaining pending thinking-end
  if (pendingThinkingEnd) {
    events.push(pendingThinkingEnd)
  }

  return { events, newState }
}
