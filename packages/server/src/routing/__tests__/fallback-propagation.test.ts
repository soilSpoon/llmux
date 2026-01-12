
import { describe, expect, it } from 'bun:test'
import { buildRoutingConfig } from '../config-builder'

describe('buildRoutingConfig Fallback Propagation', () => {
  it('propagates fallbacks to the primary target model if it does not have its own mapping', async () => {
    const mappings = [
      {
        from: 'stable-alias',
        to: ['openai/primary-model', 'openai/fallback-model'],
      },
    ]

    const result = await buildRoutingConfig(mappings)

    // We expect the auto-generated mapping for 'primary-model' to inherit the fallbacks
    // from 'stable-alias', effectively making 'primary-model' robust even if called directly.
    expect(result.modelMapping?.['primary-model']).toEqual({
      provider: 'openai',
      model: 'primary-model',
      fallbacks: ['openai/fallback-model'],
    })
  })
})
