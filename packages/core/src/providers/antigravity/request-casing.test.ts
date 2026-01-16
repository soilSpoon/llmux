import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../../../src/providers/antigravity'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('AntigravityProvider Casing', () => {
  const provider = new AntigravityProvider()
  
  it('should convert keys to snake_case in transformed request (Wire Format)', () => {
    const request: UnifiedRequest = {
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      ],
      system: 'System instruction',
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
              userId: { type: 'string' } // Camel case param should be preserved
            }
          }
        }
      ],
      config: {
        temperature: 0.7,
        maxTokens: 1000,
        stopSequences: ['END']
      },
      thinking: {
        enabled: true,
        budget: 4000,
        includeThoughts: true
      }
    }
    
    const transformed = provider.transform(request, 'antigravity-claude-sonnet-4-5-thinking') as Record<string, any>
    
    // Check wrapper keys
    expect(transformed).toHaveProperty('user_agent')
    expect(transformed).not.toHaveProperty('userAgent')
    
    expect(transformed).toHaveProperty('request_type')
    expect(transformed).not.toHaveProperty('requestType')
    
    const innerRequest = transformed.request
    
    // Check top-level keys
    expect(innerRequest).toHaveProperty('system_instruction')
    expect(innerRequest).not.toHaveProperty('systemInstruction')
    
    expect(innerRequest).toHaveProperty('generation_config')
    expect(innerRequest).not.toHaveProperty('generationConfig')
    
    expect(innerRequest).toHaveProperty('tools')
    
    // Check nested keys in generationConfig
    const genConfig = innerRequest.generation_config
    expect(genConfig).toHaveProperty('max_output_tokens')
    expect(genConfig).not.toHaveProperty('maxOutputTokens')
    
    expect(genConfig).toHaveProperty('stop_sequences')
    expect(genConfig).not.toHaveProperty('stopSequences')
    
    expect(genConfig).toHaveProperty('thinking_config')
    expect(genConfig).not.toHaveProperty('thinkingConfig')
    
    const thinkingConfig = genConfig.thinking_config
    expect(thinkingConfig).toHaveProperty('thinking_budget')
    expect(thinkingConfig).not.toHaveProperty('thinkingBudget')
    
    expect(thinkingConfig).toHaveProperty('include_thoughts')
    expect(thinkingConfig).not.toHaveProperty('includeThoughts')
    
    // Check nested keys in tools
    const tools = innerRequest.tools
    expect(tools[0]).toHaveProperty('function_declarations')
    expect(tools[0]).not.toHaveProperty('functionDeclarations')
    
    // Check parameter preservation (should NOT be snake_case)
    const params = tools[0].function_declarations[0].parameters
    expect(params.properties).toHaveProperty('userId')
    expect(params.properties).not.toHaveProperty('user_id')
  })
})
