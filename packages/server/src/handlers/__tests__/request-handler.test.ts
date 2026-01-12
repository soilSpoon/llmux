import { describe, expect, it } from 'bun:test'
import { prepareRequestContext } from '../request-handler'

describe('prepareRequestContext', () => {
  it('should respect explicit target provider in options', async () => {
    const ctx = await prepareRequestContext({
      body: { model: 'gpt-4' },
      sourceFormat: 'openai-chat',
      targetProvider: 'anthropic'
    })
    
    expect(ctx.effectiveProvider).toBe('anthropic')
    expect(ctx.currentModel).toBe('gpt-4')
  })

  it('should prioritize header target provider', async () => {
    const ctx = await prepareRequestContext({
      body: { model: 'gpt-4' },
      sourceFormat: 'openai-chat',
      targetProvider: 'openai',
      headerTargetProvider: 'anthropic'
    })
    
    expect(ctx.effectiveProvider).toBe('anthropic')
  })

  it('should detect thinking from body', async () => {
    const ctx = await prepareRequestContext({
      body: { model: 'gpt-4', thinking: { type: 'enabled' } },
      sourceFormat: 'openai-chat'
    })
    
    expect(ctx.isThinkingEnabled).toBe(true)
  })

  it('should use model mappings', async () => {
    const ctx = await prepareRequestContext({
      body: { model: 'alias-model' },
      sourceFormat: 'openai-chat',
      modelMappings: [
        { from: 'alias-model', to: { model: 'real-model', provider: 'openai-web' } }
      ]
    })
    
    expect(ctx.currentModel).toBe('real-model')
    expect(ctx.effectiveProvider).toBe('openai-web')
  })

  it('should return undefined if no provider found', async () => {
    const ctx = await prepareRequestContext({
      body: { model: 'unknown-model' },
      sourceFormat: 'openai-chat'
    })
    
    expect(ctx.effectiveProvider).toBe('unknown' as any)
  })
})
