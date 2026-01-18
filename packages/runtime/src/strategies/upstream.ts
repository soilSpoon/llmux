/**
 * Upstream Preparation Strategy Types
 *
 * These types define the interfaces for upstream request preparation,
 * handling provider-specific logic for authentication, endpoints, and context.
 *
 * Migrated from @llmux/core to @llmux/runtime as execution concerns.
 */

import type { ProviderName, ThinkingPolicy } from '@llmux/core'

/**
 * Strategy type identifiers for getStrategy<T>() lookup
 */
export type UpstreamStrategyType = 'upstream'

/**
 * Base interface for upstream strategies
 */
export interface UpstreamStrategy {
  readonly strategyType: UpstreamStrategyType
}

/**
 * Options for upstream context preparation
 */
export interface PrepareUpstreamOptions {
  model: string
  accountIndex: number
  overrideProjectId?: string
  streaming: boolean
  reqId: string
  provider: ProviderName
  retryEndpointIndex?: number
  /**
   * Computed thinking policy for this request
   * Providers can use this to set appropriate headers/config
   */
  thinkingPolicy?: ThinkingPolicy
}

/**
 * Prepared upstream context (provider-specific)
 */
export interface UpstreamContext {
  accountIndex: number
  projectId?: string
  endpoint: string
  headers: Record<string, string>
  account?: string
  providerInfo?: Record<string, unknown>
}

/**
 * Strategy for preparing provider-specific upstream request context
 *
 * Handles:
 * - Authentication header generation
 * - Endpoint selection (including retry/fallback logic)
 * - Project/account resolution
 * - Provider-specific metadata
 *
 * Used by: upstream-request-builder.ts
 * Implementations: AntigravityUpstreamStrategy, OpenAIWebUpstreamStrategy
 */
export interface UpstreamPreparationStrategy extends UpstreamStrategy {
  readonly strategyType: 'upstream'

  /**
   * Prepare upstream context for this provider
   * @throws AllCooldownError if no valid credentials are available
   */
  prepare(options: PrepareUpstreamOptions): Promise<UpstreamContext>
}
