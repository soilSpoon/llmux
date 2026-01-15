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
  options: {
    includeThoughtsInResponse?: boolean
    sendThinkingToUpstream?: boolean
    reason: string
  }
): ThinkingPolicy {
  return {
    enabled: true,
    mode,
    includeThoughtsInResponse: options.includeThoughtsInResponse ?? true,
    sendThinkingToUpstream: options.sendThinkingToUpstream ?? true,
    reason: options.reason,
  }
}
