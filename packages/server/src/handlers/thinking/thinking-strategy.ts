/**
 * ThinkingStrategy Interface
 *
 * Defines the contract for handling thinking blocks across different providers.
 * Each strategy handles pre-transform normalization, post-transform processing,
 * and conversation recovery differently.
 *
 * Strategies:
 * - claude-fresh: Strip all thinking blocks pre-request, use recovery for tool loops
 * - gemini-cache: Preserve signatures, normalize field names, remove unsigned thinking
 * - none: No thinking handling (OpenAI, etc.)
 */

import type { SignatureStore } from '../../stores/signature-store'
import type {
  SignatureProcessResult,
  ThinkingContent,
  ThinkingMessage,
  ThinkingStrategyName,
} from '../types/thinking-types'

export interface ThinkingStrategy {
  readonly name: ThinkingStrategyName

  /**
   * Pre-transform: Process contents (Gemini format) before sending to upstream.
   * May strip thinking blocks, validate signatures, etc.
   */
  processRequestContents(
    contents: ThinkingContent[],
    projectId: string,
    signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingContent>

  /**
   * Pre-transform: Process messages (Anthropic format) before sending to upstream.
   * May strip thinking blocks, validate signatures, etc.
   */
  processRequestMessages(
    messages: ThinkingMessage[],
    projectId: string,
    signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingMessage>

  /**
   * Post-transform: Normalize response contents (Gemini format).
   * May standardize signature field names, remove unsigned thinking, etc.
   */
  normalizeResponseContents(contents: ThinkingContent[]): ThinkingContent[]

  /**
   * Post-transform: Normalize response messages (Anthropic format).
   * May standardize signature field names, etc.
   */
  normalizeResponseMessages(messages: ThinkingMessage[]): ThinkingMessage[]

  /**
   * Recovery: Fix corrupted conversation state (e.g., incomplete tool loop).
   * May inject synthetic messages to close the current turn.
   */
  recoverConversation<T extends ThinkingContent | ThinkingMessage>(contents: T[]): T[]
}

/**
 * Registry of thinking strategies
 */
const strategies = new Map<ThinkingStrategyName, ThinkingStrategy>()

/**
 * Register a thinking strategy
 */
export function registerThinkingStrategy(strategy: ThinkingStrategy): void {
  strategies.set(strategy.name, strategy)
}

/**
 * Get the thinking strategy by name
 */
export function getThinkingStrategyByName(
  name: ThinkingStrategyName
): ThinkingStrategy | undefined {
  return strategies.get(name)
}

/**
 * Check if a strategy is registered
 */
export function hasThinkingStrategy(name: ThinkingStrategyName): boolean {
  return strategies.has(name)
}
