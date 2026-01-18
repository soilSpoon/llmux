
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

    // Should NOT be snake_case
    const genConfigObj = genConfig as unknown as Record<string, unknown>
    expect(genConfigObj.thinking_config).toBeUndefined()
    expect(genConfigObj.stop_sequences).toBeUndefined()
    expect(genConfigObj.max_output_tokens).toBeUndefined()
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
    expect(part?.functionCall).toBeDefined()
    if (!part) throw new Error('part is undefined')
    const partObj = part as unknown as Record<string, unknown>
    expect(partObj.function_call).toBeUndefined()

    const fc = part?.functionCall
    if (!fc) throw new Error('functionCall is undefined')

    // args -> args
    expect(fc.args).toBeDefined()

    if (typeof fc.args === 'string') throw new Error('functionCall.args is a string')
    const args = fc.args as Record<string, unknown>

    // Keys inside args should BE PRESERVED
    expect(args.camelCaseParam).toBe('value')
    expect(args.Snake_Case_Param).toBe('value')

    // Should NOT be converted
    expect(args.camel_case_param).toBeUndefined()
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
                  resultData: {
                    nestedField: 'value'
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
    expect(part?.functionResponse).toBeDefined()
    if (!part) throw new Error('part is undefined')
    const partObj = part as unknown as Record<string, unknown>
    expect(partObj.function_response).toBeUndefined()

    const fr = part?.functionResponse
    if (!fr) throw new Error('functionResponse is undefined')

    // response -> response
    expect(fr.response).toBeDefined()

    const response = fr.response as Record<string, unknown>
    const resultData = response.resultData as Record<string, unknown>

    // Keys inside response should BE PRESERVED
    expect(resultData).toBeDefined()
    expect(resultData.nestedField).toBe('value')

    // Should NOT be converted
    expect(response.result_data).toBeUndefined()
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
    const result = provider.transform(unifiedRequest, 'claude-3-7-sonnet-thinking')
    const inner = result.request as Record<string, any>

    // Check generation config (snake_case)
    const genConfig = inner.generation_config
    if (genConfig) {
      expect(genConfig).toBeDefined()
      
      expect(genConfig.thinking_config).toBeDefined()
      expect(genConfig.thinking_config?.thinking_budget).toBe(4000)
      expect(genConfig.thinking_config?.include_thoughts).toBe(true)
      
      expect(genConfig.thinkingConfig).toBeUndefined()
    } else {
        throw new Error('generation_config should be defined')
    }

    // Check tools casing
    const tools = inner.tools
    if (tools) {
      expect(tools).toBeDefined()
      // functionDeclarations -> function_declarations
      const funcDecl = tools[0]?.function_declarations
      if (funcDecl) {
        expect(funcDecl).toBeDefined()
        
        const firstDecl = funcDecl[0]
        if (!firstDecl) throw new Error('function_declarations[0] is undefined')
        
        expect(firstDecl.name).toContain('myTool')

        const params = firstDecl.parameters
        if (params) {
          const props = params.properties
          if (props) {
            expect(props.myParam).toBeDefined() // User keys preserved
            expect(props.my_param).toBeUndefined()
          }
        }
      } else {
          throw new Error('function_declarations should be defined')
      }
    } else {
        throw new Error('tools should be defined')
    }
  })
})
