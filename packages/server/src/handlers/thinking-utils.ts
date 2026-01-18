/**
 * Thinking Signature Utilities
 *
 * Shared helpers for detecting and stripping thinking blocks/signatures.
 * Used by both signature-request.ts (pre-transform) and signature-integration.ts (post-transform).
 */

import { getModelFamily } from '@llmux/core'
import type {
  ThinkingBlock,
  ThinkingContent,
  ThinkingMessage,
  ThinkingPart,
  ThinkingStrategyName,
} from './types/thinking-types'

export type { ThinkingPart, ThinkingBlock, ThinkingContent, ThinkingMessage }

export type Part = ThinkingPart
export type Block = ThinkingBlock
export type Content = ThinkingContent
export type Message = ThinkingMessage

// ============================================================================
// Strategy
// ============================================================================

export type ThinkingStrategy = ThinkingStrategyName

export function getThinkingStrategy(model?: string, provider?: string): ThinkingStrategy {
  if (!model) return 'none'
  const family = getModelFamily(model)
  if (provider === 'antigravity' && family === 'claude') return 'none'
  if (family === 'claude') return 'claude-fresh'
  if (family === 'gemini') return 'gemini-cache'
  return 'none'
}

// ============================================================================
// Detection
// ============================================================================

export function isThinkingPart(part: Part): boolean {
  return (
    part.thought === true ||
    part.type === 'thinking' ||
    part.type === 'reasoning' ||
    part.type === 'redacted_thinking' ||
    typeof part.thinking === 'string'
  )
}

export function isThinkingBlock(block: Block): boolean {
  return (
    block.type === 'thinking' ||
    block.type === 'redacted_thinking' ||
    typeof block.thinking === 'string'
  )
}

// ============================================================================
// Tool Block Detection (for protection during thinking stripping)
// ============================================================================

export function isToolUsePart(part: Part): boolean {
  return part.type === 'tool_use' || part.functionCall !== undefined
}

export function isToolResultPart(part: Part): boolean {
  return part.type === 'tool_result' || part.functionResponse !== undefined
}

export function isToolUseBlock(block: Block): boolean {
  return block.type === 'tool_use' && typeof block.id === 'string'
}

export function isToolResultBlock(block: Block): boolean {
  return block.type === 'tool_result' && typeof block.tool_use_id === 'string'
}

// ============================================================================
// Signature Extraction
// ============================================================================

export function getSignatureFromPart(part: Part): string | undefined {
  return part.thoughtSignature || part.thought_signature || part.signature
}

export function getSignatureFromBlock(block: Block): string | undefined {
  return block.signature || block.thoughtSignature || block.thought_signature
}

// ============================================================================
// Stripping
// ============================================================================

/**
 * Strip only signature fields from a part, preserving thought/text.
 * Used for Gemini project-based validation (strip invalid signatures only).
 */
export function stripSignatureFromPart(part: Part): Part {
  const { thoughtSignature, thought_signature, signature, thinkingMetadata, ...rest } = part
  return rest
}

/**
 * Strip signature fields from a block, preserving thinking content for Gemini.
 * Used for Gemini project-based validation.
 */
export function stripSignatureFromBlock(block: Block): Block {
  const { signature, thoughtSignature, thought_signature, thinkingMetadata, ...rest } = block
  return rest
}

/**
 * Completely remove a thinking part (returns empty object to be filtered out).
 * Used for Claude Fresh Signature strategy.
 */
export function removeThinkingPart(_part: Part): Part {
  return {}
}

/**
 * Completely remove a thinking block (returns empty object to be filtered out).
 * Used for Claude Fresh Signature strategy.
 */
export function removeThinkingBlock(_block: Block): Block {
  return {}
}
