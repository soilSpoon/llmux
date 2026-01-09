import { describe, it, expect } from 'bun:test'
import { createOpenAIResponsesStreamingPipeline } from '../../src/formats/openai-responses/streaming-pipeline'

describe('OpenAIResponsesStreamingPipeline Integration', () => {
  it('should capture original response ID from parse and reflect in build', () => {
    const pipeline = createOpenAIResponsesStreamingPipeline('gpt-5.1')
    const originalId = 'resp_123456789'
    
    // Simulate response.created chunk
    const createdChunk = `event: response.created\ndata: ${JSON.stringify({
      type: 'response.created',
      response: {
        id: originalId,
        object: 'response',
        status: 'in_progress',
        model: 'gpt-5.1'
      }
    })}\n\n`
    
    // Parse returns response-metadata chunk which must be passed to build
    const parsedMetadata = pipeline.parse(createdChunk)
    expect(parsedMetadata).toBeDefined()
    
    // Build the parsed metadata chunk first to update builder state
    if (parsedMetadata) {
      pipeline.build(parsedMetadata)
    }
    
    // Build a delta chunk
    const built = pipeline.build({
      type: 'content',
      blockIndex: 0,
      blockType: 'text',
      delta: { type: 'text', text: 'Hello' }
    })
    
    expect(built).toBeDefined()
    const builtStr = Array.isArray(built) ? built.join('') : built!
    expect(builtStr).toContain(originalId)
  })
})
