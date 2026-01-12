import { describe, it, expect } from 'bun:test'
import { getFormat } from '../../src/formats/registry'
import type { FormatId } from '../../src/formats/base'

describe('SchemaFormat Streaming Pipeline', () => {
  const formats: FormatId[] = [
    'openai-chat',
    'openai-responses',
    'anthropic-messages',
    'google-gemini',
  ]

  formats.forEach((formatId) => {
    it(`should implement getStreamingPipeline for ${formatId}`, () => {
      const format = getFormat(formatId)
      expect(format).toBeDefined()
      
      // Check if getStreamingPipeline exists
      // Using type assertion to any because we want to check runtime existence
      // even if types might say it's optional
      expect(typeof format?.getStreamingPipeline).toBe('function')
      
      if (format?.getStreamingPipeline) {
        // Basic pipeline sanity check
        const pipeline = format.getStreamingPipeline({
          provider: 'openai', // Dummy context
          model: 'gpt-4',
        })
        
        expect(pipeline).toBeDefined()
        expect(typeof pipeline.parse).toBe('function')
        expect(typeof pipeline.build).toBe('function')
        expect(typeof pipeline.filter).toBe('function')
        expect(typeof pipeline.flush).toBe('function')
      }
    })
  })
})
