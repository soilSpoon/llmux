/**
 * Thinking Types
 *
 * Unified type definitions for thinking/signature handling.
 * This is the single source of truth for thinking-related types.
 *
 * Used by:
 * - signature-request.ts (pre-transform)
 * - signature-integration.ts (post-transform)
 * - thinking-utils.ts (detection helpers)
 * - thinking-recovery.ts (tool loop recovery)
 */

/**
 * ThinkingPart - Gemini-style part in a content object.
 *
 * Supports:
 * - Thinking blocks with `thought: true`
 * - Signatures in various field names for compatibility
 * - Tool calls (functionCall, functionResponse)
 */
export interface ThinkingPart {
  text?: string
  thought?: boolean
  thought_signature?: string
  thoughtSignature?: string
  signature?: string
  thinking?: string
  type?: string
  functionCall?: unknown
  functionResponse?: unknown
  tool_use?: unknown
  toolUse?: unknown
  [key: string]: unknown
}

/**
 * ThinkingBlock - Anthropic-style block in a message content array.
 *
 * Supports:
 * - Thinking blocks with `type: 'thinking' | 'redacted_thinking'`
 * - Signatures in various field names
 * - Tool use blocks
 */
export interface ThinkingBlock {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  thought_signature?: string
  thoughtSignature?: string
  [key: string]: unknown
}

/**
 * ThinkingContent - Gemini format container.
 * Used in Gemini/Antigravity API requests with `contents` array.
 */
export interface ThinkingContent {
  role?: string
  parts?: ThinkingPart[]
  [key: string]: unknown
}

/**
 * ThinkingMessage - Anthropic format container.
 * Used in Anthropic API requests with `messages` array.
 */
export interface ThinkingMessage {
  role?: string
  content?: ThinkingBlock[] | string
  [key: string]: unknown
}

/**
 * ConversationMessage - Union type for conversation analysis.
 * Supports both Gemini (parts) and Anthropic (content) formats.
 */
export interface ConversationMessage {
  role?: string
  parts?: ThinkingPart[]
  content?: ThinkingBlock[] | string
  [key: string]: unknown
}

/**
 * Thinking strategy names.
 *
 * - 'claude-fresh': Strip all thinking blocks pre-request, use recovery for tool loops
 * - 'gemini-cache': Preserve signatures, normalize field names, remove unsigned thinking
 * - 'none': No thinking handling (OpenAI, etc.)
 */
export type ThinkingStrategyName = 'claude-fresh' | 'gemini-cache' | 'none'

/**
 * Signature record stored in SignatureStore.
 */
export interface SignatureRecord {
  signature: string
  projectId: string
  provider: string
  endpoint: string
  account: string
  timestamp?: number
}

/**
 * Result of signature validation/stripping operations.
 */
export interface SignatureProcessResult<T> {
  processed: T[]
  strippedCount: number
}
