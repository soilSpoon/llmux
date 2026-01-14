import { describe, expect, it } from 'bun:test'
import { ModelRouter } from '../../src/routing/model-router'
import { buildRoutingConfig } from '../../src/routing/config-builder'

describe('ModelRouter Inference Regression', () => {
  it('should resolve bare model name if it was used as a target in modelMappings with provider/ prefix', async () => {
    const modelMappings = [
      {
        from: 'my-alias',
        to: [
          'openai/primary-target',
          'antigravity/fallback-target'
        ]
      }
    ]
    
    const routingConfig = await buildRoutingConfig(modelMappings)
    const router = new ModelRouter({ modelMappings: routingConfig.modelMapping })
    
    // Primary works (already verified)
    const resPrimaryBare = await router.resolve('primary-target')
    expect(resPrimaryBare.providerId).toBe('openai')

    // THIS SHOULD FAIL (Red): Fallback bare name resolution
    const resFallbackBare = await router.resolve('fallback-target')
    expect(resFallbackBare.providerId).toBe('antigravity')
    expect(resFallbackBare.targetModel).toBe('fallback-target')
  })
})
