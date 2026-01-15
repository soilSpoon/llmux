import { describe, expect, it } from 'bun:test'
import { getRetryPolicy } from '../../src/providers/retry-policy'
import type { RetryPolicy } from '../../src/providers/retry-policy'

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
})
