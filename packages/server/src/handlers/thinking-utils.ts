/**
 * Thinking Signature Utilities
 *
 * Shared helpers for detecting and stripping thinking blocks/signatures.
 * Used by both signature-request.ts (pre-transform) and signature-integration.ts (post-transform).
 */

import { getModelFamily } from '@llmux/core'

// ============================================================================
// Types
// ============================================================================

export interface Part {
  text?: string
  thought?: boolean
  thought_signature?: string
  thoughtSignature?: string
  signature?: string
  thinking?: string
  type?: string
  [key: string]: unknown
}

export interface Content {
  role?: string
  parts?: Part[]
  [key: string]: unknown
}

export interface Block {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  thought_signature?: string
  thoughtSignature?: string
  [key: string]: unknown
}

export interface Message {
  role?: string
  content?: Block[] | string
  [key: string]: unknown
}

// ============================================================================
// Strategy
// ============================================================================

export type ThinkingStrategy = 'claude-fresh' | 'gemini-cache' | 'none'

export function getThinkingStrategy(model?: string): ThinkingStrategy {
  if (!model) return 'none'
  const family = getModelFamily(model)
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
  const { thoughtSignature, thought_signature, signature, ...rest } = part
  return rest
}

/**
 * Strip signature fields from a block, preserving thinking content for Gemini.
 * Used for Gemini project-based validation.
 */
export function stripSignatureFromBlock(block: Block): Block {
  const { signature, thoughtSignature, thought_signature, ...rest } = block
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
