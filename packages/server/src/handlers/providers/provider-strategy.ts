/**
 * ProviderRequestStrategy Interface
 *
 * Encapsulates provider-specific request preparation and error handling.
 * Each provider implements this interface to handle its unique requirements.
 */

import type { ProviderName } from '@llmux/core'

export interface PrepareContextOptions {
  model: string
  accountIndex: number
  overrideProjectId?: string | null
  streaming: boolean
  reqId?: string
}

export interface ProviderRequestContext {
  provider: ProviderName
  headers: Record<string, string>
  endpoint: string
  projectId?: string
  account?: string
  accountIndex: number
  credentials?: unknown[]
}

export interface RequestMeta {
  model: string
  thinkingEnabled?: boolean
  isClaudeFresh?: boolean
}

import type { Router } from '../../routing'

export interface ErrorContext {
  reqId?: string
  provider: ProviderName
  model: string
  status: number
  errorText: string
  currentProjectId?: string
  retryAfterMs?: number
  router?: Router
}

export interface ErrorHandlingResult {
  action: 'retry' | 'throw' | 'switch-model' | 'all-cooldown'
  newModel?: string
  newProvider?: ProviderName
  delay?: number
}

export interface RetryState {
  attempt: number
  accountIndex: number
  antigravityEndpointIndex: number
  overrideProjectId: string | null
  maxRetryAttempts: number
}

export interface ProviderRequestStrategy {
  readonly provider: ProviderName

  /**
   * Prepare request context (headers, endpoint, credentials)
   */
  prepareContext(
    options: PrepareContextOptions,
    retryState: RetryState
  ): Promise<ProviderRequestContext | null>

  /**
   * Adjust transformed body (provider-specific tweaks)
   */
  adjustTransformedBody?(
    body: Record<string, unknown>,
    meta: RequestMeta
  ): Record<string, unknown> | Promise<Record<string, unknown>>

  /**
   * Handle upstream errors (provider-specific retry logic)
   */
  handleError?(ctx: ErrorContext, retryState: RetryState): Promise<ErrorHandlingResult | null>

  /**
   * Handle network errors (provider-specific retry logic)
   */
  handleNetworkError?(error: Error, retryState: RetryState): Promise<ErrorHandlingResult | null>

  /**
   * Called when account rotation occurs
   */
  onAccountRotation?(retryState: RetryState): void

  /**
   * Handle raw stream events (e.g. for signature extraction)
   */
  handleStreamEvent?(ctx: StreamEventContext): void

  /**
   * Handle stream completion (e.g. for caching thinking)
   */
  onStreamComplete?(ctx: StreamCompleteContext): void
}

/**
 * Registry of provider strategies
 */
const strategies = new Map<ProviderName, ProviderRequestStrategy>()

export function registerProviderStrategy(strategy: ProviderRequestStrategy): void {
  strategies.set(strategy.provider, strategy)
}

export function getProviderStrategy(provider: ProviderName): ProviderRequestStrategy | undefined {
  return strategies.get(provider)
}

export function hasProviderStrategy(provider: ProviderName): boolean {
  return strategies.has(provider)
}

export interface ProviderStreamContext {
  [key: string]: unknown
}

export interface StreamEventContext {
  event: string
  context: ProviderStreamContext
  state: {
    accumulatedSignatures: string[]
  }
}

export interface StreamCompleteContext {
  context: ProviderStreamContext
  state: {
    accumulatedThinking: string
    accumulatedSignatures: string[]
    finalModel: string
    targetModel: string
  }
  reqId: string
}
