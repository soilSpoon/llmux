/**
 * Tool Pairing Validation and Repair
 *
 * Validates and fixes tool_use/tool_result pairing for Claude format messages.
 * Ported from opencode-antigravity-auth/src/plugin/request-helpers.ts
 *
 * Claude requires that each tool_use block in an assistant message has a
 * corresponding tool_result block in the immediately following user message.
 */

import { createLogger } from '@llmux/core'
import type { ThinkingBlock, ThinkingMessage } from './types/thinking-types'

const logger = createLogger({ service: 'tool-pairing' })

// ============================================================================
// Types
// ============================================================================

interface OrphanInfo {
  id: string
  name: string
  msgIndex: number
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Check if a block is a tool_use block.
 */
export function isToolUseBlock(block: ThinkingBlock): block is ThinkingBlock & { id: string } {
  return block.type === 'tool_use' && typeof block.id === 'string'
}

/**
 * Check if a block is a tool_result block.
 */
export function isToolResultBlock(
  block: ThinkingBlock
): block is ThinkingBlock & { tool_use_id: string } {
  return block.type === 'tool_result' && typeof block.tool_use_id === 'string'
}

/**
 * Find orphaned tool_use IDs (tool_use without matching tool_result).
 * Works on Claude format messages.
 */
export function findOrphanedToolUseIds(messages: ThinkingMessage[]): Set<string> {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const msg of messages) {
    if (!msg) continue
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue

        if (isToolUseBlock(block)) {
          toolUseIds.add(block.id)
        }
        if (isToolResultBlock(block)) {
          toolResultIds.add(block.tool_use_id)
        }
      }
    }
  }

  return new Set([...toolUseIds].filter((id) => !toolResultIds.has(id)))
}

/**
 * Detect tool ID mismatches in messages.
 */
export function detectToolIdMismatches(messages: ThinkingMessage[]): {
  hasMismatches: boolean
  expectedIds: string[]
  foundIds: string[]
  missingIds: string[]
  orphanIds: string[]
} {
  const expectedIds: string[] = []
  const foundIds: string[] = []

  for (const msg of messages) {
    if (!msg) continue
    if (!Array.isArray(msg.content)) continue

    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue

      if (isToolUseBlock(block)) {
        expectedIds.push(block.id)
      }
      if (isToolResultBlock(block)) {
        foundIds.push(block.tool_use_id)
      }
    }
  }

  const expectedSet = new Set(expectedIds)
  const foundSet = new Set(foundIds)

  const missingIds = expectedIds.filter((id) => !foundSet.has(id))
  const orphanIds = foundIds.filter((id) => !expectedSet.has(id))

  return {
    hasMismatches: missingIds.length > 0 || orphanIds.length > 0,
    expectedIds,
    foundIds,
    missingIds,
    orphanIds,
  }
}

// ============================================================================
// Repair
// ============================================================================

/**
 * Fix orphaned tool_use blocks in Claude format messages.
 * Injects placeholder tool_result blocks for orphans.
 *
 * @param messages - Claude format messages array
 * @returns Fixed messages with placeholder tool_results for orphans
 */
export function fixClaudeToolPairing(messages: ThinkingMessage[]): ThinkingMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages
  }

  // 1. Collect all tool_use IDs from assistant messages
  const toolUseMap = new Map<string, { name: string; msgIndex: number }>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue // Skip if undefined

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue

        if (isToolUseBlock(block)) {
          const name = typeof block.name === 'string' ? block.name : 'unknown'
          toolUseMap.set(block.id, { name, msgIndex: i })
        }
      }
    }
  }

  // 2. Collect all tool_result IDs from user messages
  const toolResultIds = new Set<string>()

  for (const msg of messages) {
    if (!msg) continue
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue

        if (isToolResultBlock(block)) {
          toolResultIds.add(block.tool_use_id)
        }
      }
    }
  }

  // 3. Find orphaned tool_use (no matching tool_result)
  const orphans: OrphanInfo[] = []

  for (const [id, info] of toolUseMap) {
    if (!toolResultIds.has(id)) {
      orphans.push({ id, ...info })
    }
  }

  if (orphans.length === 0) {
    return messages
  }

  logger.debug(
    { orphanCount: orphans.length, orphanIds: orphans.map((o) => o.id) },
    'Found orphaned tool_use blocks, injecting placeholder tool_results'
  )

  // 4. Group orphans by message index (insert after each assistant message)
  const orphansByMsgIndex = new Map<number, OrphanInfo[]>()
  for (const orphan of orphans) {
    const existing = orphansByMsgIndex.get(orphan.msgIndex) || []
    existing.push(orphan)
    orphansByMsgIndex.set(orphan.msgIndex, existing)
  }

  // 5. Build new messages array with injected tool_results
  // Deep clone messages to avoid mutation
  const result: ThinkingMessage[] = JSON.parse(JSON.stringify(messages))

  for (let i = 0; i < result.length; i++) {
    const orphansForMsg = orphansByMsgIndex.get(i)
    if (!orphansForMsg || orphansForMsg.length === 0) continue

    // Check if next message is user with tool_result - if so, merge into it
    const nextMsg = result[i + 1]

    // We need to check if nextMsg exists and is a valid user message with array content
    const isNextMsgUserWithArray =
      nextMsg && nextMsg.role === 'user' && Array.isArray(nextMsg.content)

    if (isNextMsgUserWithArray) {
      // Prepend placeholders to next message's content
      const placeholders: ThinkingBlock[] = orphansForMsg.map((o) => ({
        type: 'tool_result',
        tool_use_id: o.id,
        content: `[Tool "${o.name}" execution was cancelled or failed]`,
        is_error: true,
      }))

      // Type assertion is safe here because we checked isArray above
      nextMsg.content = [...placeholders, ...(nextMsg.content as ThinkingBlock[])]
    } else {
      // Inject new user message with placeholder tool_results after assistant message
      const placeholderMsg: ThinkingMessage = {
        role: 'user',
        content: orphansForMsg.map((o) => ({
          type: 'tool_result',
          tool_use_id: o.id,
          content: `[Tool "${o.name}" execution was cancelled or failed]`,
          is_error: true,
        })),
      }
      // Insert after current position
      result.splice(i + 1, 0, placeholderMsg)
      // Adjust indices for orphansByMsgIndex
      for (const [idx, orphs] of orphansByMsgIndex) {
        if (idx > i) {
          orphansByMsgIndex.delete(idx)
          orphansByMsgIndex.set(idx + 1, orphs)
        }
      }
    }
  }

  return result
}

/**
 * Nuclear option: Remove orphaned tool_use blocks entirely.
 * Called when fixClaudeToolPairing() fails to pair all tools.
 */
function removeOrphanedToolUse(
  messages: ThinkingMessage[],
  orphanIds: Set<string>
): ThinkingMessage[] {
  return messages
    .map((msg) => {
      if (!msg) return msg // Skip if undefined

      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.filter((block) => {
            if (!block || typeof block !== 'object') return false

            if (isToolUseBlock(block)) {
              return !orphanIds.has(block.id || '')
            }
            return true
          }),
        }
      }
      return msg
    })
    .filter(
      (msg) =>
        // Remove empty assistant messages
        msg && !(msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length === 0)
    )
}

/**
 * Validate and fix tool pairing with fallback nuclear option.
 * Defense in depth: tries gentle fix first, then nuclear removal.
 *
 * @param messages - Claude format messages array
 * @returns Fixed messages with valid tool pairing
 */
export function validateAndFixClaudeToolPairing(messages: ThinkingMessage[]): ThinkingMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages
  }

  // First: Try gentle fix (inject placeholder tool_results)
  const fixed = fixClaudeToolPairing(messages)

  // Second: Validate - find any remaining orphans
  const orphanIds = findOrphanedToolUseIds(fixed)

  if (orphanIds.size === 0) {
    return fixed
  }

  // Third: Nuclear option - remove orphaned tool_use entirely
  // This should rarely happen, but provides defense in depth
  logger.warn(
    { orphanIds: [...orphanIds] },
    'fixClaudeToolPairing left orphans, applying nuclear option'
  )

  return removeOrphanedToolUse(fixed, orphanIds)
}

// ============================================================================
// Pre-flight Validation (for error detection before upstream)
// ============================================================================

/**
 * Validates that all tool_use blocks have corresponding tool_result blocks
 * in the immediately following user message (Anthropic's strict requirement).
 *
 * @param messages - Claude format messages array
 * @returns Validation result with error details if invalid
 */
export function validateToolPairingStrict(messages: ThinkingMessage[]): {
  valid: boolean
  errors: Array<{
    messageIndex: number
    toolUseId: string
    toolName: string
    error: string
  }>
} {
  const errors: Array<{
    messageIndex: number
    toolUseId: string
    toolName: string
    error: string
  }> = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue // Skip if undefined

    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue

    // Find all tool_use in this assistant message
    const toolUseBlocks = msg.content.filter(isToolUseBlock)
    if (toolUseBlocks.length === 0) continue

    // Get the next message
    const nextMsg = messages[i + 1]
    if (!nextMsg || nextMsg.role !== 'user') {
      // No user message follows - all tool_use are orphaned
      for (const block of toolUseBlocks) {
        if (!isToolUseBlock(block)) continue

        errors.push({
          messageIndex: i,
          toolUseId: block.id || '',
          toolName: typeof block.name === 'string' ? block.name : 'unknown',
          error: `No user message follows assistant message with tool_use`,
        })
      }
      continue
    }

    // Check that next user message has tool_result for each tool_use
    const toolResultIds = new Set<string>()
    if (Array.isArray(nextMsg.content)) {
      for (const block of nextMsg.content) {
        if (!block || typeof block !== 'object') continue

        if (isToolResultBlock(block)) {
          toolResultIds.add(block.tool_use_id)
        }
      }
    }

    for (const block of toolUseBlocks) {
      if (!toolResultIds.has(block.id)) {
        errors.push({
          messageIndex: i,
          toolUseId: block.id,
          toolName: typeof block.name === 'string' ? block.name : 'unknown',
          error: `Missing tool_result in following user message`,
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
