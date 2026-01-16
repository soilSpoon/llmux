import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../../../src/providers/antigravity'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('AntigravityProvider Casing', () => {
  const provider = new AntigravityProvider()
  
  it('should maintain camelCase keys in transformed request', () => {
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
              location: { type: 'string' }
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
    
    const transformed = provider.transform(request, 'antigravity-claude-sonnet-4-5-thinking')
    const innerRequest = transformed.request as Record<string, any>
    
    // Check top-level keys
    expect(innerRequest).toHaveProperty('systemInstruction')
    expect(innerRequest).not.toHaveProperty('system_instruction')
    
    expect(innerRequest).toHaveProperty('generationConfig')
    expect(innerRequest).not.toHaveProperty('generation_config')
    
    expect(innerRequest).toHaveProperty('tools')
    
    // Check nested keys in generationConfig
    const genConfig = innerRequest.generationConfig
    expect(genConfig).toHaveProperty('maxOutputTokens')
    expect(genConfig).not.toHaveProperty('max_output_tokens')
    
    expect(genConfig).toHaveProperty('stopSequences')
    expect(genConfig).not.toHaveProperty('stop_sequences')
    
    expect(genConfig).toHaveProperty('thinkingConfig')
    expect(genConfig).not.toHaveProperty('thinking_config')
    
    const thinkingConfig = genConfig.thinkingConfig
    expect(thinkingConfig).toHaveProperty('thinkingBudget')
    expect(thinkingConfig).not.toHaveProperty('thinking_budget')
    
    expect(thinkingConfig).toHaveProperty('includeThoughts')
    expect(thinkingConfig).not.toHaveProperty('include_thoughts')
    
    // Check nested keys in tools
    const tools = innerRequest.tools
    expect(tools[0]).toHaveProperty('functionDeclarations')
    expect(tools[0]).not.toHaveProperty('function_declarations')
  })
})
