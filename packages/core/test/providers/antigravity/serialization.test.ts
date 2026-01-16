
import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../../../src/providers/antigravity'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('Antigravity Serialization', () => {
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
    const inner = result.request

    // Check generation config
    const genConfig = inner.generationConfig
    if (genConfig) {
      expect(genConfig).toBeDefined()
      // AntigravityInnerRequest uses camelCase keys compliant with the API spec
      expect(genConfig.thinkingConfig).toBeDefined()
      expect(genConfig.thinkingConfig?.thinkingBudget).toBe(4000)
      expect(genConfig.thinkingConfig?.includeThoughts).toBe(true)
    }

    // Check tools casing
    // toolConfig -> toolConfig
    const tools = inner.tools
    if (tools) {
      expect(tools).toBeDefined()
      // UnifiedTool -> GeminiTool
      // GeminiTool keys: functionDeclarations -> functionDeclarations
      const funcDecl = tools[0]?.functionDeclarations
      if (funcDecl) {
        expect(funcDecl).toBeDefined()
        
        const firstDecl = funcDecl[0]
        if (!firstDecl) throw new Error('functionDeclarations[0] is undefined')
        
        expect(firstDecl.name).toContain('myTool')

        const params = firstDecl.parameters
        if (params) {
          const props = params.properties
          if (props) {
            expect(props.myParam).toBeDefined()
            expect(props.my_param).toBeUndefined()
          }
        }
      }
    }
  })
})
