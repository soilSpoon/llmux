import { describe, it, expect } from 'bun:test'
import { OpenAIChatStreamingBuilder } from '../../src/formats/openai-chat/openai-streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

describe('OpenAIChatStreamingBuilder', () => {
  it('should initialize correctly', () => {
    const builder = new OpenAIChatStreamingBuilder()
    expect(builder).toBeDefined()
  })

  it('should build text delta', () => {
    const builder = new OpenAIChatStreamingBuilder()
    const chunk: StreamChunk = {
      type: 'text-delta',
      delta: { type: 'text', text: 'Hello' }
    }
    
    const results = builder.build(chunk)
    expect(results.length).toBe(1)
    expect(results[0]).toContain('data: ')
  })

  it('should emit [DONE] on finish chunk', () => {
    const builder = new OpenAIChatStreamingBuilder()
    
    builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
    
    const finishResults = builder.build({ type: 'done' })
    
    expect(finishResults.some(r => r.includes('[DONE]'))).toBe(true)
  })

  describe('flush() guarantees [DONE]', () => {
    it('flush after text stream should emit [DONE]', () => {
      const builder = new OpenAIChatStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      
      const flushResults = builder.flush()
      
      expect(flushResults.length).toBe(1)
      expect(flushResults[0]).toContain('[DONE]')
    })

    it('flush on idle builder should emit [DONE]', () => {
      const builder = new OpenAIChatStreamingBuilder()
      
      const flushResults = builder.flush()
      
      expect(flushResults.length).toBe(1)
      expect(flushResults[0]).toContain('[DONE]')
    })

    it('flush after already finished stream should return empty', () => {
      const builder = new OpenAIChatStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      builder.build({ type: 'done' })
      
      const flushResults = builder.flush()
      
      expect(flushResults.length).toBe(0)
    })

    it('double flush should be idempotent', () => {
      const builder = new OpenAIChatStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Hello' } })
      
      const flush1 = builder.flush()
      const flush2 = builder.flush()
      
      expect(flush1.some(r => r.includes('[DONE]'))).toBe(true)
      expect(flush2.length).toBe(0)
    })

    it('CRITICAL: abrupt stream termination still guarantees [DONE]', () => {
      const builder = new OpenAIChatStreamingBuilder()
      
      builder.build({ type: 'text-delta', delta: { text: 'Partial...' } })
      
      const flushResults = builder.flush()
      
      expect(flushResults.some(r => r.includes('[DONE]'))).toBe(true)
    })
  })
})
