import { describe, it, expect } from 'bun:test'
import { createAntigravityStreamingPipeline } from '../../../src/providers/antigravity/streaming-pipeline'

describe('Antigravity Streaming Pipeline Integration', () => {
  it('should transform Gemini 3 text response into Anthropic SSE', () => {
    const pipeline = createAntigravityStreamingPipeline('gemini-3-pro-preview')
    
    // Simulating Gemini 3 response chunk
    const rawChunk = JSON.stringify({
      response: {
        candidates: [{
          content: {
            role: 'model',
            parts: [{
              text: 'Hello world',
              thoughtSignature: 'some-sig'
            }]
          }
        }]
      }
    })
    const sseChunk = `data: ${rawChunk}\n\n`

    // 1. Parse
    const parsed = pipeline.parse(sseChunk)
    expect(parsed).not.toBeNull()
    
    // 2. Build
    // parsed can be single chunk or array
    const chunks = Array.isArray(parsed) ? parsed : [parsed!]
    const built = pipeline.build(chunks)
    
    expect(built).not.toBeNull()
    const builtEvents = Array.isArray(built) ? built : [built!]
    
    // Check for message_start (auto-emitted) and content_block_delta
    const combinedOutput = builtEvents.join('')
    
    expect(combinedOutput).toContain('event: message_start')
    
    // Should contain content_block_start for text
    expect(combinedOutput).toContain('event: content_block_start')
    expect(combinedOutput).toContain('"type":"text"')
    
    expect(combinedOutput).toContain('event: content_block_delta')
    expect(combinedOutput).toContain('"text":"Hello world"')
  })

  it('should transform Gemini 3 thinking response into Anthropic SSE', () => {
    const pipeline = createAntigravityStreamingPipeline('gemini-3-pro-preview')
    
    const rawChunk = JSON.stringify({
      response: {
        candidates: [{
          content: {
            role: 'model',
            parts: [{
              text: 'Thinking...',
              thought: true,
              thoughtSignature: 'sig'
            }]
          }
        }]
      }
    })
    const sseChunk = `data: ${rawChunk}\n\n`

    const parsed = pipeline.parse(sseChunk)
    const chunks = Array.isArray(parsed) ? parsed : [parsed!]
    const built = pipeline.build(chunks)
    
    const combinedOutput = (Array.isArray(built) ? built : [built!]).join('')
    
    // Check for thinking start and delta
    expect(combinedOutput).toContain('event: content_block_start')
    expect(combinedOutput).toContain('"type":"thinking"')
    expect(combinedOutput).toContain('event: content_block_delta')
    expect(combinedOutput).toContain('"thinking":"Thinking..."')
  })
})