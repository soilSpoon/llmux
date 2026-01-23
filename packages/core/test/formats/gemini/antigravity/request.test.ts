import { describe, expect, it } from 'bun:test'
import { buildAntigravityRequest } from '../../../../src/formats/gemini/antigravity/request'
import type { UnifiedRequest } from '../../../../src/types/unified'

describe('Antigravity Request Builder', () => {
  const baseRequest: UnifiedRequest = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    model: 'gemini-pro', // mapped to model in envelope if needed, but context has project/location/model
    metadata: {
        project: 'test-project',
        location: 'us-central1',
        model: 'some-model'
    }
  }

  // Mock Context
  const context = {
     project: 'test-project',
     location: 'us-central1',
     model: 'gemini-1.5-pro-001'
  }

  it('should build a basic text request wrapped in envelope', () => {
    const req = buildAntigravityRequest(baseRequest, context)

    expect(req.project).toBe('test-project')
    expect(req.model).toBe('gemini-1.5-pro-001')
    const firstContent = req.request.contents[0]
    if (!firstContent) throw new Error('Expected contents to have at least one element')
    expect(firstContent.parts[0]).toEqual({ text: 'hello' })
  })

  it('should convert system instruction to object format', () => {
    const req = buildAntigravityRequest({
        ...baseRequest,
        system: 'be helpfull'
    }, context)

    expect(req.request.system_instruction || req.request.systemInstruction).toEqual({
        parts: [{ text: 'be helpfull' }]
    })
  })

  it('should handle tools with name encoding', () => {
    const req = buildAntigravityRequest({
        ...baseRequest,
        tools: [{
            name: 'my-tool',
            description: 'desc',
            parameters: { type: 'object', properties: {} }
        }]
    }, context)

    const firstTool = req.request.tools?.[0]
    if (!firstTool) throw new Error('Expected tools to have at least one element')
    const tool = firstTool.functionDeclarations[0]
    expect(tool?.name).toMatch(/^t/) 
    // decoded name would be checked in codec tests, here just check encoded form
  })

  it('should apply Claude thinking config', () => {
    const claudeContext = { ...context, model: 'claude-3-5-sonnet-thinking' }
    const req = buildAntigravityRequest({
        ...baseRequest,
        thinking: { enabled: true, budget: 4000 }
    }, claudeContext)

    expect(req.request.generation_config).toHaveProperty('thinking_config')
    // @ts-ignore
    expect(req.request.generation_config?.thinking_config?.thinking_budget).toBe(4000)
  })
})
