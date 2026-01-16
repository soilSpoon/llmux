/**
 * Tests for computeThinkingPolicy function
 *
 * Verifies that thinking policy is correctly computed from various inputs,
 * respecting priority order and model capabilities.
 */

import { describe, expect, it } from 'bun:test'
import { computeThinkingPolicy } from '../../src/thinking'

describe('computeThinkingPolicy', () => {
  // ==========================================================================
  // CLAUDE FRESH MODE
  // ==========================================================================

  describe('Claude Fresh mode', () => {
    it('disables thinking when isClaudeFresh is true', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        isClaudeFresh: true,
      })

      expect(policy.enabled).toBe(false)
      expect(policy.mode).toBe('none')
      expect(policy.sendThinkingToUpstream).toBe(false)
      expect(policy.reason).toContain('Claude Fresh')
    })

    it('Claude Fresh takes priority over client thinking enabled', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: true, includeThoughts: true },
        isClaudeFresh: true,
      })

      expect(policy.enabled).toBe(false)
      expect(policy.reason).toContain('Claude Fresh')
    })
  })

  // ==========================================================================
  // THINKING MODEL + STREAMING
  // ==========================================================================

  describe('thinking model with streaming', () => {
    it('returns interleaved mode for Claude thinking model', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('interleaved')
      expect(policy.sendThinkingToUpstream).toBe(true)
      expect(policy.includeThoughtsInResponse).toBe(true)
    })

    it('returns interleaved mode for Gemini 3 model', () => {
      const policy = computeThinkingPolicy({
        model: 'gemini-3-pro',
        mode: 'streaming',
        targetProvider: 'gemini',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('interleaved')
    })

    it('returns interleaved mode for Gemini 2.5 model', () => {
      const policy = computeThinkingPolicy({
        model: 'gemini-2.5-flash',
        mode: 'streaming',
        targetProvider: 'gemini',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('interleaved')
    })
  })

  // ==========================================================================
  // THINKING MODEL + NON-STREAMING
  // ==========================================================================

  describe('thinking model with non-streaming', () => {
    it('returns standard mode for Claude thinking model', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'non-streaming',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('standard')
      expect(policy.sendThinkingToUpstream).toBe(true)
    })

    it('returns standard mode for count_tokens', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'count_tokens',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('standard')
    })
  })

  // ==========================================================================
  // CLIENT THINKING CONFIGURATION
  // ==========================================================================

  describe('explicit client thinking config', () => {
    it('respects client enabled: false', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: false },
      })

      expect(policy.enabled).toBe(false)
      expect(policy.reason).toContain('Client explicitly disabled')
    })

    it('client enabled: false takes priority over thinking model', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: false },
        optionsThinking: true,
      })

      expect(policy.enabled).toBe(false)
    })

    it('respects client includeThoughts: false', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: true, includeThoughts: false },
      })

      expect(policy.enabled).toBe(true)
      expect(policy.includeThoughtsInResponse).toBe(false)
    })

    it('defaults includeThoughts to true when not specified', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: true },
      })

      expect(policy.includeThoughtsInResponse).toBe(true)
    })
  })

  // ==========================================================================
  // OPTIONS-LEVEL THINKING
  // ==========================================================================

  describe('options-level thinking', () => {
    it('respects optionsThinking: false', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        optionsThinking: false,
      })

      expect(policy.enabled).toBe(false)
      expect(policy.reason).toContain('Options-level')
    })
  })

  // ==========================================================================
  // NON-THINKING MODELS
  // ==========================================================================

  describe('non-thinking models', () => {
    it('disables thinking for GPT-4o', () => {
      const policy = computeThinkingPolicy({
        model: 'gpt-4o',
        mode: 'streaming',
        targetProvider: 'openai',
      })

      expect(policy.enabled).toBe(false)
      expect(policy.reason).toContain('does not support thinking')
    })

    it('disables thinking for Claude non-thinking model', () => {
      const policy = computeThinkingPolicy({
        model: 'claude-3-5-sonnet',
        mode: 'streaming',
        targetProvider: 'anthropic',
      })

      expect(policy.enabled).toBe(false)
      expect(policy.reason).toContain('does not support thinking')
    })

    it('disables thinking for Gemini 2.0 model (no thinking support)', () => {
      const policy = computeThinkingPolicy({
        model: 'gemini-2.0-flash',
        mode: 'streaming',
        targetProvider: 'gemini',
      })

      expect(policy.enabled).toBe(false)
    })

    it('disables thinking even with client enabled for non-thinking model', () => {
      const policy = computeThinkingPolicy({
        model: 'gpt-4o',
        mode: 'streaming',
        clientThinking: { enabled: true, includeThoughts: true },
        targetProvider: 'openai',
      })

      expect(policy.enabled).toBe(false)
    })
  })

  // ==========================================================================
  // PRIORITY ORDER VERIFICATION
  // ==========================================================================

  describe('priority order', () => {
    it('Claude Fresh > client enabled > options > model capability', () => {
      // Claude Fresh has highest priority
      const freshPolicy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: true },
        optionsThinking: true,
        isClaudeFresh: true,
      })
      expect(freshPolicy.enabled).toBe(false)
      expect(freshPolicy.reason).toContain('Claude Fresh')

      // Client disable next
      const clientDisablePolicy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        clientThinking: { enabled: false },
        optionsThinking: true,
        isClaudeFresh: false,
      })
      expect(clientDisablePolicy.enabled).toBe(false)
      expect(clientDisablePolicy.reason).toContain('Client')

      // Options disable next
      const optionsPolicy = computeThinkingPolicy({
        model: 'claude-3-7-sonnet-thinking',
        mode: 'streaming',
        optionsThinking: false,
        isClaudeFresh: false,
      })
      expect(optionsPolicy.enabled).toBe(false)
      expect(optionsPolicy.reason).toContain('Options')

      // Model capability check last
      const modelPolicy = computeThinkingPolicy({
        model: 'gpt-4o',
        mode: 'streaming',
        isClaudeFresh: false,
        targetProvider: 'openai',
      })
      expect(modelPolicy.enabled).toBe(false)
      expect(modelPolicy.reason).toContain('does not support')
    })
  })

  // ==========================================================================
  // OPENAI O1/O3 MODELS
  // ==========================================================================

  describe('OpenAI reasoning models', () => {
    it('enables thinking for o1-preview with OpenAI provider', () => {
      const policy = computeThinkingPolicy({
        model: 'o1-preview',
        mode: 'streaming',
        targetProvider: 'openai',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('interleaved')
    })

    it('enables thinking for o3-mini with OpenAI provider', () => {
      const policy = computeThinkingPolicy({
        model: 'o3-mini',
        mode: 'non-streaming',
        targetProvider: 'openai',
      })

      expect(policy.enabled).toBe(true)
      expect(policy.mode).toBe('standard')
    })

    it('disables thinking for o1-preview without OpenAI provider', () => {
      const policy = computeThinkingPolicy({
        model: 'o1-preview',
        mode: 'streaming',
        targetProvider: 'anthropic', // Wrong provider
      })

      expect(policy.enabled).toBe(false)
    })
  })
})
