import { describe, it, expect } from 'bun:test'

import type { ProviderName } from '../../src/types/providers'

describe('Type Separation', () => {
  it('should export ProviderName from shared types module', () => {
    // This test is mainly a compilation check for the import
    // But we can also check if we can assign valid values to it
    const p1: ProviderName = 'openai'
    const p2: ProviderName = 'anthropic'
    const p3: ProviderName = 'google'
    const p4: ProviderName = 'antigravity'
    
    expect(p1).toBe('openai')
    expect(p2).toBe('anthropic')
    expect(p3).toBe('google')
    expect(p4).toBe('antigravity')
  })
})
