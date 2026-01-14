/**
 * Provider Strategy Interfaces
 *
 * These interfaces define strategies that providers can implement to handle
 * provider-specific logic in a composable way, avoiding interface pollution
 * and maintaining the Single Responsibility Principle.
 *
 * Design Pattern: Strategy Pattern + Composition
 * - Providers compose strategy instances rather than implementing many optional methods
 * - Strategies are independently testable and reusable across providers
 * - Handlers remain provider-agnostic by using strategies polymorphically
 */

import type { ProviderName } from './providers'

/**
 * Strategy type identifiers for getStrategy<T>() lookup
 */
export type StrategyType = 'upstream' | 'thinking' | 'metadata' | 'rateLimit' | 'errorHandling'

/**
 * Base interface for all provider strategies
 */
export interface ProviderStrategy {
  readonly strategyType: StrategyType
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPSTREAM PREPARATION STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

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
export interface UpstreamPreparationStrategy extends ProviderStrategy {
  readonly strategyType: 'upstream'

  /**
   * Prepare upstream context for this provider
   * @throws AllCooldownError if no valid credentials are available
   */
  prepare(options: PrepareUpstreamOptions): Promise<UpstreamContext>
}

// ═══════════════════════════════════════════════════════════════════════════════
// THINKING STRATEGY RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Thinking strategy mode
 *
 * - 'claude-fresh': Claude Fresh signature mode (strip all signatures unconditionally)
 * - 'gemini-cache': Gemini cache mode (validate signatures against project)
 * - 'standard': Standard thinking mode (no special signature handling)
 * - 'none': No thinking support
 */
export type ThinkingMode = 'claude-fresh' | 'gemini-cache' | 'standard' | 'none'

/**
 * Strategy for resolving model-specific thinking behavior
 *
 * Handles:
 * - Determining thinking mode for a given model
 * - Signature stripping policy (Claude Fresh)
 * - Thinking block inclusion/exclusion rules
 *
 * Used by: streaming.ts, signature-request.ts, request-sanitizer.ts
 * Implementations: ClaudeFreshThinkingStrategy, GeminiCacheThinkingStrategy
 */
export interface ThinkingStrategyResolver extends ProviderStrategy {
  readonly strategyType: 'thinking'

  /**
   * Get the thinking mode for a specific model
   */
  getMode(model: string): ThinkingMode

  /**
   * Should signatures be stripped for this model?
   * @returns true if all thinking signatures should be removed
   */
  shouldStripSignatures(model: string): boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA INJECTION STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Metadata to inject into the request
 */
export interface RequestMetadataInjection {
  project?: string
  model?: string
  requestId?: string
  [key: string]: unknown
}

/**
 * Strategy for injecting provider-specific metadata into requests
 *
 * Handles:
 * - Project ID injection (Antigravity)
 * - Request ID injection
 * - Model override injection
 * - Custom metadata fields
 *
 * Used by: upstream-request-builder.ts
 * Implementations: AntigravityMetadataStrategy
 */
export interface MetadataInjectionStrategy extends ProviderStrategy {
  readonly strategyType: 'metadata'

  /**
   * Check if this provider requires metadata injection
   */
  requiresInjection(model: string): boolean

  /**
   * Generate metadata to inject into the request
   */
  getMetadata(options: {
    model: string
    projectId?: string
    requestId?: string
  }): RequestMetadataInjection
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMIT STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rate limit context information
 */
export interface RateLimitContext {
  isWeeklyLimit: boolean
  limitType: 'hard' | 'soft' | 'unknown'
  family?: string
  retryAfterMs?: number
  endpointIndex?: number
  endpoint?: string
}

/**
 * Strategy for handling provider-specific rate limiting logic
 *
 * Handles:
 * - Detecting weekly limits (Claude on Antigravity)
 * - Determining rate limit type (hard/soft)
 * - Providing debug information for logging
 *
 * Used by: request-handler.ts
 * Implementations: ClaudeWeeklyLimitStrategy
 */
export interface RateLimitStrategy extends ProviderStrategy {
  readonly strategyType: 'rateLimit'

  /**
   * Get rate limit context for the current request/error
   */
  getContext(options: {
    model: string
    family?: string
    retryAfterMs?: number
    accountIndex?: number
    endpointIndex?: number
  }): RateLimitContext
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context for error handling strategy
 */
export interface ErrorHandlingOptions {
  provider: ProviderName
  model: string
  originalModel?: string
  status: number
  errorText: string
  retryAfterMs?: number
  currentProjectId?: string
}

/**
 * Result of error handling strategy
 */
export interface ErrorHandlingAction {
  action: 'retry' | 'throw' | 'switch-model' | 'all-cooldown'
  newModel?: string
  newProvider?: ProviderName
  delay?: number
}

/**
 * Strategy for interpreting and responding to upstream errors
 *
 * Handles:
 * - Detecting license errors (Antigravity/Gemini)
 * - Suggesting fallback models or providers
 * - Determining custom retry delays
 *
 * Used by: request-handler.ts
 * Implementations: AntigravityErrorStrategy
 */
export interface ErrorHandlingStrategy extends ProviderStrategy {
  readonly strategyType: 'errorHandling'

  /**
   * Interpret an upstream error and suggest an action
   * @returns SUGGESTED action, or null if this strategy doesn't have a specific advice
   */
  handleError(options: ErrorHandlingOptions): Promise<ErrorHandlingAction | null>
}
