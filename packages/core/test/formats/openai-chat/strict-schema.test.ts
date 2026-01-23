
import { describe, it, expect } from 'bun:test'
import { transformTool } from '../../../src/formats/openai-chat/tools'
import type { UnifiedTool } from '../../../src/types/unified'

describe('OpenAI Chat Tools', () => {
  it('should apply strict: true by default for function tools', () => {
    const unifiedTool: UnifiedTool = {
      name: 'get_weather',
      description: 'Get weather info',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' }
        },
        required: ['location']
      }
    }

    const transformed = transformTool(unifiedTool)
    
    expect(transformed.type).toBe('function')
    expect(transformed.function.strict).toBe(true)
  })

  it('should preserve parameters when strict: true is applied', () => {
    const unifiedTool: UnifiedTool = {
      name: 'get_weather',
      description: 'Get weather info',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' }
        },
        required: ['location']
      }
    }

    const transformed = transformTool(unifiedTool)
    
    expect(transformed.function.parameters).toBeDefined()
    expect(transformed.function.parameters?.properties).toEqual({
      location: { type: 'string' }
    })
  })
})
