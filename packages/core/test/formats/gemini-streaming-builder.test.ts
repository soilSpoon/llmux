import { describe, it, expect } from 'bun:test'
import { GeminiStreamingBuilder } from '../../src/formats/google-gemini/streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

describe('GeminiStreamingBuilder', () => {
  it('should initialize correctly', () => {
    const builder = new GeminiStreamingBuilder()
    expect(builder).toBeDefined()
  })

  it('should build text delta', () => {
    const builder = new GeminiStreamingBuilder()
    const chunk: StreamChunk = {
      type: 'text-delta',
      delta: { type: 'text', text: 'Hello' }
    }
    
    const results = builder.build(chunk)
    expect(results.length).toBe(1)
    expect(results[0]).toContain('data: ')
    const parsed = JSON.parse(results[0]!.replace(/^data: /, ''))
    expect(parsed.candidates[0].content.parts[0].text).toBe('Hello')
  })

  it('should accumulate parts and flush on finish', () => {
    const builder = new GeminiStreamingBuilder()
    
    // Chunk 1
    builder.build({
      type: 'text-delta',
      delta: { type: 'text', text: 'Hello' }
    })
    
    // Chunk 2
    builder.build({
      type: 'text-delta',
      delta: { type: 'text', text: ' world' }
    })
    
    // Finish
    const finishChunk: StreamChunk = {
      type: 'finish',
      finishReason: { unified: 'end_turn', raw: 'STOP' },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    }
    
    // Build finish chunk (sets state but doesn't emit immediately if no parts accumulated in THIS call,
    // actually based on implementation: finish chunk returns [] but updates state)
    const finishResults = builder.build(finishChunk)
    expect(finishResults.length).toBe(0)
    
    // Flush to get final chunk with usage/finish reason
    const flushResults = builder.flush()
    expect(flushResults.length).toBe(1)
    
    const finalParsed = JSON.parse(flushResults[0]!.replace(/^data: /, ''))
    expect(finalParsed.candidates[0].finishReason).toBe('STOP')
    expect(finalParsed.usageMetadata.totalTokenCount).toBe(15)
  })

  it('should handle tool calls', () => {
    const builder = new GeminiStreamingBuilder()
    
    builder.build({
      type: 'tool-call-start',
      toolCall: { name: 'calculator', id: 'call_1' }
    })
    
    const chunkInput: StreamChunk = {
      type: 'tool-input-delta',
      delta: { partialJson: '{"a": 1}' }
    }
    
    const results = builder.build(chunkInput)
    // The builder emits immediately if parts exist
    // Implementation check: 
    // - tool-call-start adds a part to accumulatedParts
    // - tool-input-delta updates the last part
    // - if accumulatedParts > 0, it emits
    
    expect(results.length).toBe(1)
    const parsed = JSON.parse(results[0]!.replace(/^data: /, ''))
    expect(parsed.candidates[0].content.parts[0].functionCall.name).toBe('calculator')
    // The streaming-builder uses JSON.parse on the partialJson which is correct for complete JSON strings,
    // but typically partialJson might be incomplete in a real stream.
    // However, in this test we provide complete JSON.
    // The test expects object, so it should match.
    expect(parsed.candidates[0].content.parts[0].functionCall.args).toEqual({ a: 1 })
  })

  it('should handle thinking/thought deltas', () => {
    const builder = new GeminiStreamingBuilder()
    const chunk: StreamChunk = {
        type: 'thinking-delta',
        delta: { thinking: { text: 'Thinking...', signature: 'sig' } }
    }
    const results = builder.build(chunk)
    expect(results.length).toBe(1)
    const parsed = JSON.parse(results[0]!.replace(/^data: /, ''))
    expect(parsed.candidates[0].content.parts[0].text).toBe('Thinking...')
    expect(parsed.candidates[0].content.parts[0].thought).toBe(true)
  })

  describe('flush() guarantees finishReason', () => {
    it('flush after text stream should emit finishReason STOP', () => {
      const builder = new GeminiStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      builder.build({ type: 'finish', finishReason: { unified: 'end_turn', raw: 'STOP' } })
      
      const flushResults = builder.flush()
      
      expect(flushResults.length).toBe(1)
      const parsed = JSON.parse(flushResults[0]!.replace(/^data: /, ''))
      expect(parsed.candidates[0].finishReason).toBe('STOP')
    })

    it('flush on idle builder should return empty', () => {
      const builder = new GeminiStreamingBuilder()
      
      const flushResults = builder.flush()
      
      expect(flushResults.length).toBe(0)
    })

    it('flush after started but no finish should return empty (Gemini requires explicit finish)', () => {
      const builder = new GeminiStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      
      const flushResults = builder.flush()
      
      expect(flushResults.length).toBe(0)
    })

    it('flush should include usage metadata', () => {
      const builder = new GeminiStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hi' } })
      builder.build({ 
        type: 'finish', 
        finishReason: { unified: 'end_turn', raw: 'STOP' },
        usage: { inputTokens: 100, outputTokens: 50 }
      })
      
      const flushResults = builder.flush()
      const parsed = JSON.parse(flushResults[0]!.replace(/^data: /, ''))
      
      expect(parsed.usageMetadata.promptTokenCount).toBe(100)
      expect(parsed.usageMetadata.candidatesTokenCount).toBe(50)
    })

    it('double flush should be idempotent', () => {
      const builder = new GeminiStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      builder.build({ type: 'finish', finishReason: { unified: 'end_turn', raw: 'STOP' } })
      
      const flush1 = builder.flush()
      const flush2 = builder.flush()
      
      expect(flush1.length).toBe(1)
      expect(flush2.length).toBe(0)
    })
  })
})
