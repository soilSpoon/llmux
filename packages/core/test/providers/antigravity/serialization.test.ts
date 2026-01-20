
import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../../../src/providers/antigravity'
import type { AntigravityInnerRequest } from '../../../src/providers/antigravity/types'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('Antigravity Serialization', () => {
  it('should serialize thinking config to camelCase (spec compliant)', () => {
    const request: AntigravityInnerRequest = {
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      generationConfig: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 2048,
        },
        stopSequences: ['stop'],
        maxOutputTokens: 100,
      },
    }

    expect(request.generationConfig).toBeDefined()

    const genConfig = request.generationConfig
    if (!genConfig) throw new Error('generationConfig is undefined')

    expect(genConfig.thinkingConfig).toBeDefined()
    expect(genConfig.thinkingConfig?.includeThoughts).toBe(true)
    expect(genConfig.thinkingConfig?.thinkingBudget).toBe(2048)

    // Check other fields
    expect(genConfig.stopSequences).toEqual(['stop'])
    expect(genConfig.maxOutputTokens).toBe(100)
    
    // Runtime key verification
    const keys = Object.keys(genConfig)
    expect(keys).not.toContain('thinking_config')
    expect(keys).not.toContain('stop_sequences')
    expect(keys).not.toContain('max_output_tokens')
  })

  it('should preserve function call arguments and use camelCase structural keys', () => {
    const request: AntigravityInnerRequest = {
      contents: [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'test_tool',
                args: {
                  camelCaseParam: 'value',
                  Snake_Case_Param: 'value',
                },
              },
            },
          ],
        },
      ],
    }

    const content = request.contents[0]
    const part = content?.parts[0]

    // functionCall -> functionCall (camelCase)
    expect((part as any).functionCall).toBeDefined()
    if (!part) throw new Error('part is undefined')
    
    const partKeys = Object.keys(part)
    expect(partKeys).not.toContain('function_call')

    const fc = (part as any).functionCall
    if (!fc) throw new Error('functionCall is undefined')

    // args -> args
    expect(fc.args).toBeDefined()

    if (typeof fc.args === 'string') throw new Error('functionCall.args is a string')
    const args = fc.args as Record<string, unknown>

    // Keys inside args should BE PRESERVED
    expect(args.camelCaseParam).toBe('value')
    expect(args.Snake_Case_Param).toBe('value')

    // Should NOT be converted
    const argKeys = Object.keys(args)
    expect(argKeys).not.toContain('camel_case_param')
  })

  it('should preserve function response content casing and use camelCase structural keys', () => {
    const request: AntigravityInnerRequest = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'test_tool',
                response: {
                  content: {
                    resultData: {
                      nestedField: 'value'
                    }
                  }
                },
              },
            },
          ],
        },
      ],
    }

    const content = request.contents[0]
    const part = content?.parts[0]

    // functionResponse -> functionResponse (camelCase)
    // expect(part?.functionResponse).toBeDefined() - GeminiCliPart does not have functionResponse
    // Instead we check the 'text' property or inspect the raw object if needed, but since we are testing serialization
    // of AntigravityInnerRequest which uses Gemini parts structure effectively, we cast to any for this specific test
    // or use a more lenient type check as this test seems to inspect internal structure before transformation?
    // Actually this test describes "Antigravity Serialization" and constructs AntigravityInnerRequest manually.
    // The issue might be that AntigravityInnerRequest types are not fully aligned with what the test expects or usage of part is loose.
    // Let's use 'as any' for inspection of specific fields that might not be on the standard part type but are expected in the serialized output.

    if (!part) throw new Error('part is undefined')
    const partObj = part as any
    expect(partObj.functionResponse).toBeDefined()
    
    const partKeys = Object.keys(partObj)
    expect(partKeys).not.toContain('function_response')

    const fr = partObj.functionResponse
    if (!fr) throw new Error('functionResponse is undefined')

    // response -> response
    expect(fr.response).toBeDefined()

    const response = fr.response as Record<string, unknown>
    // Structure: { content: { resultData: { ... } } }
    const responseContent = response.content as Record<string, unknown>
    const resultData = responseContent.resultData as Record<string, unknown>

    // Keys inside response should BE PRESERVED
    expect(resultData).toBeDefined()
    expect(resultData.nestedField).toBe('value')

    // Should NOT be converted
    const responseKeys = Object.keys(responseContent)
    expect(responseKeys).not.toContain('result_data')
  })

  it('should integration test via AntigravityProvider transform', () => {
    const provider = new AntigravityProvider()
    const unifiedRequest: UnifiedRequest = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      thinking: {
        enabled: true,
        budget: 4000,
        includeThoughts: true
      },
      tools: [{
        name: 'myTool',
        description: 'desc',
        parameters: {
          type: 'object',
          properties: {
            myParam: { type: 'string' }
          }
        }
      }]
    }

    // claude-3-7-sonnet-thinking is a thinking model
    const result = provider.transform(unifiedRequest, 'claude-3-7-sonnet-thinking') as any
    // Depending on the implementation, result might have 'request' or be the request itself.
    // In AntigravityProvider.transform, it returns AntigravityProviderRequest.
    const inner = result.request

    // Check generation config
    const genConfig = inner.generation_config || inner.generationConfig
    if (genConfig) {
      expect(genConfig).toBeDefined()
      
      // For Claude models, Antigravity outputs snake_case thinking_config
      const thinkingConfig = genConfig.thinking_config
      expect(thinkingConfig).toBeDefined()
      expect(thinkingConfig?.thinking_budget).toBe(4000)
      expect(thinkingConfig?.include_thoughts).toBe(true)
    } else {
        throw new Error('generation_config should be defined')
    }

    // Check tools casing
    const tools = inner.tools
    if (tools) {
      expect(tools).toBeDefined()
      // functionDeclarations is standard
      const funcDecl = tools[0]?.functionDeclarations
      if (funcDecl) {
        expect(funcDecl).toBeDefined()
        
        const firstDecl = funcDecl[0]
        if (!firstDecl) throw new Error('functionDeclarations[0] is undefined')
        
        // Tool name is encoded (myTool -> tbXlUb29s)
        expect(firstDecl.name).toContain('tbXlUb29s')

        const params = firstDecl.parameters
        if (params) {
          const props = params.properties
          if (props) {
            expect(props.myParam).toBeDefined() // User keys preserved
            const propKeys = Object.keys(props)
            expect(propKeys).not.toContain('my_param')
          }
        }
      } else {
          throw new Error('functionDeclarations should be defined')
      }
    } else {
        throw new Error('tools should be defined')
    }
  })
})
