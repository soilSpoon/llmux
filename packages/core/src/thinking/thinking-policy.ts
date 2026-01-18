/**
 * ThinkingPolicy - Centralized thinking decision type
 *
 * This type represents the computed policy for handling thinking/reasoning
 * features for a given request. It encapsulates all decisions about:
 * - Whether thinking is enabled
 * - What mode to use (interleaved, signature, etc.)
 * - Whether to include thoughts in the response
 * - Whether to send thinking config to upstream
 *
 * The policy is computed once at the start of request processing and
 * passed through the pipeline, replacing scattered boolean flags.
 */

import type { ThinkingMode } from '../types/provider-strategies'

/**
 * Thinking policy for a request
 *
 * This is the single source of truth for thinking behavior decisions.
 * Computed by `computeThinkingPolicy()` based on model, client config,
 * and provider capabilities.
 */
export interface ThinkingPolicy {
  /**
   * Whether thinking is enabled for this request
   * - true: Thinking features should be active
   * - false: Thinking features should be disabled
   */
  enabled: boolean

  /**
   * The thinking mode to use
   * - 'claude-fresh': Claude Fresh mode (strip signatures, no caching)
   * - 'gemini-cache': Gemini cache mode (validate signatures)
   * - 'standard': Standard thinking mode
   * - 'interleaved': Interleaved thinking mode (streaming)
   * - 'none': No thinking support
   */
  mode: ThinkingMode | 'interleaved'

  /**
   * Whether to include thinking blocks in the response to the client
   */
  includeThoughtsInResponse: boolean

  /**
   * Whether to send thinking configuration to the upstream provider
   */
  sendThinkingToUpstream: boolean

  /**
   * Human-readable reason for this policy decision
   * Useful for debugging and logging
   */
  reason: string
}

/**
 * Factory function to create a disabled thinking policy
 */
export function createDisabledThinkingPolicy(reason: string): ThinkingPolicy {
  return {
    enabled: false,
    mode: 'none',
    includeThoughtsInResponse: false,
    sendThinkingToUpstream: false,
    reason,
  }
}

/**
 * Factory function to create an enabled thinking policy
 */
export function createEnabledThinkingPolicy(
  mode: ThinkingPolicy['mode'],
  options?: {
    includeThoughtsInResponse?: boolean
    sendThinkingToUpstream?: boolean
    reason: string
  }
): ThinkingPolicy {
  return {
    enabled: true,
    mode,
    includeThoughtsInResponse: options?.includeThoughtsInResponse ?? true,
    sendThinkingToUpstream: options?.sendThinkingToUpstream ?? true,
    reason: options?.reason ?? 'Enabled by default',
  }
}

/**
 * Thinking configuration from client request
 */
export interface ClientThinkingConfig {
  enabled?: boolean
  budget?: number
  includeThoughts?: boolean
}

/**
 * Options for computing thinking policy
 */
export interface ComputeThinkingPolicyOptions {
  model: string
  mode: 'streaming' | 'non-streaming' | 'count_tokens'
  clientThinking?: ClientThinkingConfig
  optionsThinking?: boolean
  isClaudeFresh?: boolean
  sourceFormat?: string
  targetProvider?: string
}

/**
 * Computes the thinking policy from request inputs
 *
 * This centralizes thinking behavior decisions, replacing scattered boolean flags.
 * The policy is computed once at the start of request processing.
 *
 * Priority order:
 * 1. Claude Fresh mode -> disabled (must not send thinking to upstream)
 * 2. Explicit client thinking.enabled = false -> disabled
 * 3. Explicit client thinking.enabled = true -> enabled
 * 4. Options-level isThinkingEnabled = false -> disabled
 * 5. Non-thinking model -> disabled
 * 6. Thinking model + streaming -> interleaved mode
 * 7. Thinking model + non-streaming -> standard mode
 *
 * @param options - The inputs to compute policy from
 * @returns ThinkingPolicy with computed behavior decisions
 *
 * @example
 * const policy = computeThinkingPolicy({
 *   model: 'claude-3-7-sonnet-thinking',
 *   mode: 'streaming',
 *   clientThinking: { enabled: true, includeThoughts: true },
 *   isClaudeFresh: false,
 * })
 */
export function computeThinkingPolicy(options: ComputeThinkingPolicyOptions): ThinkingPolicy {
  const { model, mode, clientThinking, optionsThinking, isClaudeFresh, targetProvider } = options

  // Import locally to avoid circular dependencies at module level
  const { isThinkingModel } = require('./model-capabilities')

  // 1. Claude Fresh mode always disables thinking
  if (isClaudeFresh) {
    return createDisabledThinkingPolicy(
      'Claude Fresh mode - thinking disabled for signature stripping'
    )
  }

  // 2. Explicit client disable takes priority
  if (clientThinking?.enabled === false) {
    return createDisabledThinkingPolicy('Client explicitly disabled thinking')
  }

  // 3. Options-level explicit disable
  if (optionsThinking === false) {
    return createDisabledThinkingPolicy('Options-level thinking disabled')
  }

  // 4. Non-thinking model
  if (!isThinkingModel(model, targetProvider)) {
    return createDisabledThinkingPolicy('Model does not support thinking')
  }

  // 5. Thinking model - determine mode based on streaming
  const thinkingMode = mode === 'streaming' ? 'interleaved' : 'standard'
  const includeThoughts = clientThinking?.includeThoughts ?? true

  return createEnabledThinkingPolicy(thinkingMode, {
    includeThoughtsInResponse: includeThoughts,
    sendThinkingToUpstream: true,
    reason: `Thinking model with ${mode} mode`,
  })
}
