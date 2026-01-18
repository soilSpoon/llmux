import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '@llmux/core'
import type { UnifiedRequest } from '@llmux/core'
import type { ProviderName } from '@llmux/core'

// Mock environment
process.env.ANTIGRAVITY_API_KEY = 'test-key'

describe('E2E: Format Compatibility', () => {
  const provider = new AntigravityProvider({
    apiKey: 'test-key',
    model: 'claude-3-5-sonnet',
  } as any)

  it('should transform OpenAI format to Antigravity format', () => {
    // OpenAI format request (as parsed by OpenAI provider)
    const openaiRequest: UnifiedRequest = {
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'You are a helpful assistant.' }] }, // Mapped from system if needed or user
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      ],
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
        maxTokens: 1000
      }
    }

    const transformed = provider.transform(openaiRequest, 'claude-3-5-sonnet' as ProviderName) as any

    // Verify Antigravity structure
    expect(transformed.request).toBeDefined()
    expect(transformed.request.contents).toBeDefined() // Contents might include both if system prompt not extracted or merged
    expect(transformed.request.systemInstruction).toBeDefined()
    // System instruction might be in the request structure or merged into contents
    const hasSystemText = transformed.request.systemInstruction.parts.some((p: any) => p.text.includes('You are a helpful assistant')) ||
                          transformed.request.contents.some((c: any) => c.parts.some((p: any) => p.text.includes('You are a helpful assistant')))
    expect(hasSystemText).toBe(true)
    
    expect(transformed.request.tools).toBeDefined()
    // Antigravity tools are wrapped in function_declarations (snake_case in wire format)
    expect(transformed.request.tools[0].function_declarations[0].name).toBe('get_weather')
    
    // Wire format check (snake_case)
    expect(transformed.request_type).toBe('agent')
    expect(transformed.user_agent).toBe('antigravity')
  })

  it('should transform Anthropic format to Antigravity format', () => {
    // Anthropic format request (as parsed by Anthropic provider)
    const anthropicRequest: UnifiedRequest = {
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
      ],
      system: 'You are Claude.',
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
        temperature: 0.5,
        maxTokens: 4000,
        stopSequences: ['END']
      }
    }

    const transformed = provider.transform(anthropicRequest, 'claude-3-5-sonnet' as ProviderName) as any

    // For Anthropic, system prompt handling depends on the model
    // Antigravity transform injects system prompt into innerRequest
    // Check if it's there OR in contents (fallback)
    
    const hasSystemInstruction = transformed.request.systemInstruction?.parts?.[0]?.text?.includes('You are Claude')
    const hasSystemInContents = transformed.request.contents?.some((c: any) => c.parts?.some((p: any) => p.text?.includes('You are Claude')))
    
    expect(hasSystemInstruction || hasSystemInContents).toBe(true)
    
    // Generation config check (wire format is snake_case)
    expect(transformed.request.generation_config.stop_sequences).toContain('END')
    expect(transformed.request.generation_config.max_output_tokens).toBe(4000)
  })

  it('should handle Gemini CLI format conversion', () => {
    // Gemini CLI often sends snake_case keys in loose JSON
    // We simulate this by checking how convertKeysDeep handles it at the boundary
    
    const request = {
      project: 'test-project',
      model: 'gemini-1.5-pro',
      request: {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generation_config: {
          stop_sequences: ['END'],
          temperature: 0.5
        }
      }
    }
    
    // If this came in as raw input to parse()
    const parsed = provider.parse(request)
    
    // Should be normalized to camelCase in UnifiedRequest
    expect(parsed.config?.stopSequences).toContain('END')
    expect(parsed.config?.temperature).toBe(0.5)
  })
})
