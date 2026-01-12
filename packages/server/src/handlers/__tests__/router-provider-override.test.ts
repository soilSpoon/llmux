import { describe, expect, it, mock } from 'bun:test'
import type { Router } from '../../routing'
import { prepareRequestContext } from '../request-handler'

describe('Router Provider Override', () => {
  it('should allow router to override provider even if one was selected by mapping', async () => {
    // Mock Router
    const mockRouter = {
      resolveModel: mock(() => Promise.resolve({
        provider: 'gemini-cli',
        model: 'gemini-3-flash-preview',
        isFallback: true
      })),
      handleRateLimit: mock(() => {}),
    } as unknown as Router

    // Simulate mapping that selects 'antigravity' initially
    // The prepareRequestContext logic sees the mapping, sets initialTargetProvider='antigravity'.
    // Then it calls router.resolveModel.
    // The router returns 'gemini-cli'.
    // The BUG is that it ignores 'gemini-cli' if initialTargetProvider is set.
    const ctx = await prepareRequestContext({
      body: { model: 'claude-opus-4-5-20251101' },
      sourceFormat: 'anthropic-messages',
      modelMappings: [
        { 
          from: 'claude-opus-4-5-20251101', 
          to: ['antigravity/claude-opus-4-5-thinking'] 
        }
      ],
      router: mockRouter
    })

    // Expectation: The router returned 'gemini-cli', so we expect 'gemini-cli'
    expect(ctx.effectiveProvider).toBe('gemini-cli')
    expect(ctx.currentModel).toBe('gemini-3-flash-preview')
  })
})
