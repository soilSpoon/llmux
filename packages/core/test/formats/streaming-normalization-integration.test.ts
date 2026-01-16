import { describe, expect, it } from 'bun:test'
import {
  AnthropicStreamingBuilder,
} from '../../src/formats/anthropic-messages/anthropic-streaming-builder'
import {
  OpenAIChatStreamingBuilder,
} from '../../src/formats/openai-chat/openai-streaming-builder'
import {
  OpenAIResponsesStreamingBuilder,
} from '../../src/formats/openai-responses/streaming-builder'
import {
  GeminiStreamingBuilder,
} from '../../src/formats/google-gemini/streaming-builder'
import { StreamChunk } from '../../src/types/unified'

describe('Streaming Builders Normalization Integration', () => {
  describe('AnthropicStreamingBuilder', () => {
    it('should normalize stream order by inserting thinking-end before text', () => {
      const builder = new AnthropicStreamingBuilder('claude-3-opus-20240229')
      
      const chunk1: StreamChunk = { type: 'thinking-start' }
      const chunk2: StreamChunk = { type: 'text-delta', delta: { text: 'Hello' } } // Premature text!
      
      builder.build(chunk1)
      builder.build(chunk2)
      
      // Verify state
      const state = (builder as any).state
      expect(state.normalization.hasThinkingStarted).toBe(true)
      expect(state.normalization.hasThinkingEnded).toBe(true)
      expect(state.normalization.hasTextStarted).toBe(true)
    })
  })

  describe('OpenAIStreamingBuilder', () => {
    it('should normalize stream order', () => {
      const builder = new OpenAIChatStreamingBuilder()
      
      const chunk1: StreamChunk = { type: 'thinking-start' }
      const chunk2: StreamChunk = { type: 'text-delta', delta: { text: 'Hello' } } // Premature text!
      
      builder.build(chunk1)
      builder.build(chunk2)
      
      // Verify state
      const state = (builder as any).state
      expect(state.normalization.hasThinkingStarted).toBe(true)
      expect(state.normalization.hasThinkingEnded).toBe(true)
      expect(state.normalization.hasTextStarted).toBe(true)
    })
  })

  describe('GeminiStreamingBuilder', () => {
    it('should normalize stream order', () => {
      const builder = new GeminiStreamingBuilder()
      
      const chunk1: StreamChunk = { type: 'thinking-start' }
      const chunk2: StreamChunk = { type: 'text-delta', delta: { text: 'Hello' } }
      
      builder.build(chunk1)
      builder.build(chunk2)
      
      const state = (builder as any).state
      expect(state.normalization.hasThinkingStarted).toBe(true)
      expect(state.normalization.hasThinkingEnded).toBe(true)
      expect(state.normalization.hasTextStarted).toBe(true)
    })
  })

  describe('OpenAIResponsesStreamingBuilder', () => {
    it('should normalize stream order', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-4o')
      
      const chunk1: StreamChunk = { type: 'thinking-start' }
      const chunk2: StreamChunk = { type: 'text-delta', delta: { text: 'Hello' } }
      
      builder.build(chunk1)
      builder.build(chunk2)
      
      const state = (builder as any).state
      expect(state.normalization.hasThinkingStarted).toBe(true)
      expect(state.normalization.hasThinkingEnded).toBe(true)
      expect(state.normalization.hasTextStarted).toBe(true)
    })
  })
})
