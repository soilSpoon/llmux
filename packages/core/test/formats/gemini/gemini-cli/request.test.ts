import { describe, expect, it } from 'bun:test'
import { buildGeminiCliRequest } from '../../../../src/formats/gemini/gemini-cli/request'
import type { UnifiedRequest } from '../../../../src/types/unified'

describe('Gemini-CLI Request Builder', () => {
  const baseRequest: UnifiedRequest = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    model: 'gemini-1.5-pro-001'
  }

  // Mock Context (CLI doesn't use envelope, but might need context for capabilities later)
  const context = {
     project: 'p',
     location: 'l',
     model: 'gemini-1.5-pro-001'
  }

  it('should build a request without envelope', () => {
    const req = buildGeminiCliRequest(baseRequest, context)

    expect('project' in req).toBe(false) // No envelope
    const firstContent = req.contents[0]
    if (!firstContent) throw new Error('Expected contents to have at least one element')
    expect(firstContent.parts[0]).toEqual({ text: 'hello' })
  })

  it('should use camelCase generationConfig', () => {
     const req = buildGeminiCliRequest({
         ...baseRequest,
         config: { temperature: 0.7 }
     }, context)
     
     expect(req.generationConfig?.temperature).toBe(0.7)
  })

  it('should apply Gemini thinking config in camelCase', () => {
    const capsContext = { ...context, model: 'gemini-2.0-flash-thinking' }
    const req = buildGeminiCliRequest({
        ...baseRequest,
        thinking: { enabled: true, budget: 1024 }
    }, capsContext)

    // Gemini 2.x uses thinkingBudget, camelCase
    expect(req.generationConfig?.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 1024
    })
  })

  it('should encode tool names', () => {
      const req = buildGeminiCliRequest({
          ...baseRequest,
          tools: [{ name: 'my/tool', description: 'd', parameters: { type: 'object', properties: {} } }]
      }, context)
      
      const firstTool = req.tools?.[0]
      if (!firstTool) throw new Error('Expected tools to have at least one element')
      const firstDecl = firstTool.functionDeclarations?.[0]
      if (!firstDecl) throw new Error('Expected functionDeclarations to have at least one element')
      expect(firstDecl.name).toMatch(/^t/)
  })
})
