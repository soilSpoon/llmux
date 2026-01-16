import { describe, expect, it, beforeEach, afterAll } from 'bun:test'
import { getRetryPolicy } from '../../src/providers/retry-policy'
import type { RetryPolicy } from '../../src/providers/retry-policy'
import { ZERO_COST_MODELS } from '../../src/util/model-capabilities'

describe('retry-policy', () => {
  describe('getRetryPolicy', () => {
    it('should return default policy for openai provider', () => {
      const policy = getRetryPolicy('openai')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return default policy for anthropic provider', () => {
      const policy = getRetryPolicy('anthropic')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return default policy for gemini provider', () => {
      const policy = getRetryPolicy('gemini')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return default policy for antigravity provider', () => {
      const policy = getRetryPolicy('antigravity')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return default policy for unknown provider', () => {
      const policy = getRetryPolicy('unknown')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return default policy regardless of model', () => {
      const policy = getRetryPolicy('openai', 'gpt-5.1')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return default policy regardless of deploymentId', () => {
      const policy = getRetryPolicy('openai', 'gpt-5.1', 'deployment-123')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should return a new object each time (immutable)', () => {
      const policy1 = getRetryPolicy('openai')
      const policy2 = getRetryPolicy('openai')
      expect(policy1).not.toBe(policy2)
      expect(policy1).toEqual(policy2)
    })
  })

  describe('RetryPolicy interface', () => {
    it('should have required fields', () => {
      const policy: RetryPolicy = {
        maxAttempts: 5,
        budgetCheckRequired: false,
      }
      expect(policy.maxAttempts).toBe(5)
      expect(policy.budgetCheckRequired).toBe(false)
    })
  })

  describe('zero-cost model integration', () => {
    const originalModels = [...ZERO_COST_MODELS]

    beforeEach(() => {
      ZERO_COST_MODELS.length = 0
    })

    afterAll(() => {
      ZERO_COST_MODELS.length = 0
      ZERO_COST_MODELS.push(...originalModels)
    })

    it('should set budgetCheckRequired to false for zero-cost models', () => {
      ZERO_COST_MODELS.push('free-tier-model')
      const policy = getRetryPolicy('openai', 'free-tier-model')
      expect(policy.maxAttempts).toBe(3)
      expect(policy.budgetCheckRequired).toBe(false)
    })

    it('should keep budgetCheckRequired true for non-zero-cost models', () => {
      ZERO_COST_MODELS.push('free-tier-model')
      const policy = getRetryPolicy('openai', 'gpt-4')
      expect(policy.budgetCheckRequired).toBe(true)
    })

    it('should work with any provider', () => {
      ZERO_COST_MODELS.push('internal-model')
      expect(getRetryPolicy('openai', 'internal-model').budgetCheckRequired).toBe(false)
      expect(getRetryPolicy('anthropic', 'internal-model').budgetCheckRequired).toBe(false)
      expect(getRetryPolicy('gemini', 'internal-model').budgetCheckRequired).toBe(false)
    })

    it('should keep budgetCheckRequired true when no model is provided', () => {
      ZERO_COST_MODELS.push('free-model')
      const policy = getRetryPolicy('openai')
      expect(policy.budgetCheckRequired).toBe(true)
    })
  })
})
