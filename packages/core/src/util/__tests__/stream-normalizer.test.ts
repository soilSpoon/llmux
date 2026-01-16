import { describe, expect, it } from 'bun:test'
import { StreamChunk } from '../../types'
import { normalizeStreamingOrder } from '../stream-normalizer'

describe('normalizeStreamingOrder', () => {
  it('should pass through normal sequence unchanged', () => {
    const state = {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    }

    // 1. thinking-start
    const start: StreamChunk = { type: 'thinking-start' }
    const res1 = normalizeStreamingOrder(start, state)
    expect(res1).toHaveLength(1)
    expect(res1[0]).toBe(start)
    expect(state.hasThinkingStarted).toBe(true)

    // 2. thinking-delta
    const delta: StreamChunk = { type: 'thinking-delta', delta: { text: 'thought' } }
    const res2 = normalizeStreamingOrder(delta, state)
    expect(res2).toHaveLength(1)
    expect(res2[0]).toBe(delta)

    // 3. thinking-end
    const end: StreamChunk = { type: 'thinking-end' }
    const res3 = normalizeStreamingOrder(end, state)
    expect(res3).toHaveLength(1)
    expect(res3[0]).toBe(end)
    expect(state.hasThinkingEnded).toBe(true)

    // 4. text-delta
    const text: StreamChunk = { type: 'text-delta', delta: { text: 'hello' } }
    const res4 = normalizeStreamingOrder(text, state)
    expect(res4).toHaveLength(1)
    expect(res4[0]).toBe(text)
    expect(state.hasTextStarted).toBe(true)
  })

  it('should insert synthetic thinking-end when text starts before thinking ends', () => {
    const state = {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    }

    // 1. thinking-start
    const start: StreamChunk = { type: 'thinking-start', id: 'chunk-1' }
    normalizeStreamingOrder(start, state)

    // 2. text-delta (premature!)
    const text: StreamChunk = { type: 'text-delta', id: 'chunk-2', delta: { text: 'hello' } }
    const res = normalizeStreamingOrder(text, state)

    // Should include synthetic thinking-end first
    expect(res).toHaveLength(2)
    expect(res[0]!.type).toBe('thinking-end')
    expect(res[0]!.id).toBe('chunk-2') // Inherits ID from trigger chunk
    expect(res[1]).toBe(text)

    // State should be corrected
    expect(state.hasThinkingStarted).toBe(true)
    expect(state.hasThinkingEnded).toBe(true)
    expect(state.hasTextStarted).toBe(true)
  })

  it('should not interfere if thinking never started', () => {
    const state = {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    }

    const text: StreamChunk = { type: 'text-delta', delta: { text: 'hello' } }
    const res = normalizeStreamingOrder(text, state)

    expect(res).toHaveLength(1)
    expect(res[0]).toBe(text)
    expect(state.hasThinkingStarted).toBe(false)
    expect(state.hasThinkingEnded).toBe(false)
    expect(state.hasTextStarted).toBe(true)
  })

  it('should handle multiple text chunks correctly', () => {
    const state = {
      hasThinkingStarted: true,
      hasThinkingEnded: false, // Simulate thinking started but not ended
      hasTextStarted: false,
    }

    // 1. First text chunk (triggers fix)
    const text1: StreamChunk = { type: 'text-delta', delta: { text: 'hello' } }
    const res1 = normalizeStreamingOrder(text1, state)
    expect(res1).toHaveLength(2)
    expect(res1[0]!.type).toBe('thinking-end')
    expect(res1[1]!.type).toBe('text-delta')

    // 2. Second text chunk (should pass through)
    const text2: StreamChunk = { type: 'text-delta', delta: { text: ' world' } }
    const res2 = normalizeStreamingOrder(text2, state)
    expect(res2).toHaveLength(1)
    expect(res2[0]).toBe(text2)
  })
})
