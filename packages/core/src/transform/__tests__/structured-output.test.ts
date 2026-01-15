
import { describe, expect, test, beforeAll } from 'bun:test'
import { transformRequest } from '../../transform/request'
import { registerProvider } from '../../providers/registry'
import { GeminiProvider } from '../../providers/gemini'
import { AnthropicProvider } from '../../providers/anthropic'
import { OpenAIProvider } from '../../providers/openai'

describe('Structured Output Transformation', () => {
  beforeAll(() => {
    // Register providers for testing
    registerProvider('gemini', new GeminiProvider())
    registerProvider('anthropic', new AnthropicProvider())
    registerProvider('openai', new OpenAIProvider())
  })

  const openAiRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Extract data' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'extraction',
        schema: {
          type: 'object',
          properties: {
            foo: { type: 'string' },
            bar: { type: 'number' },
          },
          required: ['foo', 'bar'],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  }

  test('OpenAI -> Gemini: Maps to responseSchema', () => {
    const result = transformRequest(openAiRequest, {
      from: 'openai',
      to: 'gemini',
      model: 'gemini-1.5-pro',
    }) as any

    expect(result.generationConfig.responseMimeType).toBe('application/json')
    expect(result.generationConfig.responseSchema).toBeDefined()
    expect(result.generationConfig.responseSchema.type).toBe('OBJECT')
    expect(result.generationConfig.responseSchema.properties.foo.type).toBe('STRING')
    expect(result.generationConfig.responseSchema.properties.bar.type).toBe('NUMBER')
  })

  test('OpenAI -> Anthropic: Maps to tool use', () => {
    const result = transformRequest(openAiRequest, {
      from: 'openai',
      to: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    }) as any

    expect(result.tools).toBeDefined()
    expect(result.tools.length).toBe(1)
    expect(result.tools[0].name).toBe('extraction')
    expect(result.tools[0].input_schema.properties.foo.type).toBe('string')
    
    expect(result.tool_choice).toBeDefined()
    expect(result.tool_choice.type).toBe('tool')
    expect(result.tool_choice.name).toBe('extraction')
  })

  test('Validation: Throws on missing schema', () => {
    const invalidRequest = {
      ...openAiRequest,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'broken' } // Missing schema
      }
    }

    expect(() => {
      transformRequest(invalidRequest, {
        from: 'openai',
        to: 'gemini',
        model: 'gemini-1.5-pro',
      })
    }).toThrow('Structured output requires a valid JSON schema')
  })
})

