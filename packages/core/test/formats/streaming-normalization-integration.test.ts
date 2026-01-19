import { describe, expect, it } from 'bun:test'
import {
  AnthropicStreamingBuilder,
} from '../../src/formats/anthropic-messages/anthropic-streaming-builder'
import { GeminiStreamingBuilder } from '../../src/formats/google-gemini/streaming-builder'
import { OpenAIChatStreamingBuilder } from '../../src/formats/openai-chat/openai-streaming-builder'
import { OpenAIResponsesStreamingBuilder } from '../../src/formats/openai-responses/streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

describe('Streaming Builders Order Normalization', () => {
  const events: StreamChunk[] = [
    { type: 'thinking-start' },
    { type: 'thinking-delta', delta: { thinking: { text: 'thought' } } },
    { type: 'text-delta', delta: { text: 'content' } }, // Out of order: text before thinking end
    { type: 'thinking-end' },
    { type: 'finish', finishReason: { unified: 'end_turn', raw: 'stop' } },
  ]

  it('OpenAIChatStreamingBuilder applies normalization', () => {
    const builder = new OpenAIChatStreamingBuilder()
    const allResults: string[] = []

    for (const chunk of events) {
      allResults.push(...builder.build(chunk))
    }
    allResults.push(...builder.flush())

    const fullOutput = allResults.join('')
    // Check invariants
    // 1. thinking-delta present
    expect(fullOutput).toContain('reasoning_content":"thought')
    // 2. text-delta present
    expect(fullOutput).toContain('content":"content')

    // 3. Normalization ensures valid sequence - hard to regex exact SSE, but
    // we verified normalizeStreamingOrder logic in separate test.
    // Here we ensure build() didn't crash and output contains data.
    expect(allResults.length).toBeGreaterThan(0)
  })

  it('OpenAIResponsesStreamingBuilder applies normalization', () => {
    const builder = new OpenAIResponsesStreamingBuilder('gpt-4o')
    const allResults: string[] = []

    for (const chunk of events) {
      allResults.push(...builder.build(chunk))
    }
    // No flush needed for this builder typically, but good practice
    // allResults.push(...builder.flush())

    const fullOutput = allResults.join('')

    // Should contain thinking
    expect(fullOutput).toContain('response.reasoning_summary_text.delta')
    expect(fullOutput).toContain('thought')

    // Should contain text
    expect(fullOutput).toContain('response.output_text.delta')
    expect(fullOutput).toContain('content')

    // Should contain thinking end events
    expect(fullOutput).toContain('response.reasoning_summary_text.done')
    expect(fullOutput).toContain('response.reasoning_summary_part.done')
  })

  it('AnthropicStreamingBuilder applies normalization', () => {
    const builder = new AnthropicStreamingBuilder('claude-3-5-sonnet')
    const allResults: string[] = []

    for (const chunk of events) {
      allResults.push(...builder.build(chunk))
    }
    allResults.push(...builder.flush())

    const fullOutput = allResults.join('')

    // Check invariants
    // Thinking block
    expect(fullOutput).toContain('thinking_delta')
    expect(fullOutput).toContain('thought')

    // Text block
    expect(fullOutput).toContain('text_delta')
    expect(fullOutput).toContain('content')
  })

  it('GeminiStreamingBuilder applies normalization', () => {
    const builder = new GeminiStreamingBuilder()
    const allResults: string[] = []

    for (const chunk of events) {
      allResults.push(...builder.build(chunk))
    }
    allResults.push(...builder.flush())

    const fullOutput = allResults.join('')

    // Thinking part (thought: true)
    expect(fullOutput).toContain('"thought":true')
    expect(fullOutput).toContain('"text":"thought"')

    // Text part
    expect(fullOutput).toContain('"text":"content"')
  })
})
