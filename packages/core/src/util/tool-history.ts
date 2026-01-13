import { CANCELLATION_REASONS } from '../types/tool-run'
import type { ContentPart, UnifiedMessage } from '../types/unified'

/**
 * Normalizes tool history to ensure every tool call has a matching result.
 * Injects synthetic cancellation results for open tool loops.
 * Groups tool calls and results to maintain adjacency.
 *
 * @param messages - The conversation history
 * @returns Normalized conversation history
 */
export function normalizeToolHistory(messages: UnifiedMessage[]): UnifiedMessage[] {
  if (!messages || messages.length === 0) {
    return messages
  }

  // Helper to merge consecutive same-role messages
  const mergeSameRoles = (msgs: UnifiedMessage[]): UnifiedMessage[] => {
    const merged: UnifiedMessage[] = []
    for (const msg of msgs) {
      const last = merged[merged.length - 1]
      if (last && last.role === msg.role) {
        last.parts = [...last.parts, ...msg.parts]
      } else {
        merged.push({ ...msg })
      }
    }
    return merged
  }

  // 1. Initial merge to handle cases where assistant text is split from tool calls
  const currentMessages = mergeSameRoles(messages)

  const normalizedMessages: UnifiedMessage[] = []
  const synthesizedIds = new Set<string>()

  // 2. Identify and handle missing tool results
  for (let i = 0; i < currentMessages.length; i++) {
    const message = currentMessages[i]
    if (!message) continue

    // Filter out results we're about to synthesize or have already synthesized
    // This handles moving results "up" to satisfy adjacency requirements
    if (
      message.role === 'tool' ||
      (message.role === 'user' && message.parts.some((p) => p.type === 'tool_result'))
    ) {
      const remainingParts = message.parts.filter(
        (p) =>
          p.type !== 'tool_result' || !p.toolResult || !synthesizedIds.has(p.toolResult.toolCallId)
      )
      if (remainingParts.length === 0) continue
      normalizedMessages.push({ ...message, parts: remainingParts })
    } else {
      normalizedMessages.push(message)
    }

    // Check Assistant tool calls
    const toolCallParts = message.parts.filter((p) => p.type === 'tool_call')
    if (message.role === 'assistant' && toolCallParts.length > 0) {
      const callIds = toolCallParts
        .map((p) => p.toolCall?.id)
        .filter((id): id is string => id !== undefined)

      // Peek at next message for results
      const nextMsg = currentMessages[i + 1]
      const nextIsUser = nextMsg && (nextMsg.role === 'user' || nextMsg.role === 'tool')

      const foundInNext = new Set<string>()
      if (nextIsUser) {
        for (const p of nextMsg.parts) {
          if (p.type === 'tool_result' && p.toolResult) {
            foundInNext.add(p.toolResult.toolCallId)
          }
        }
      }

      const missingIds = callIds.filter((id) => !foundInNext.has(id))

      if (missingIds.length > 0) {
        // We MUST close this loop immediately
        const synthMsg = createSyntheticResultMessage(missingIds, new Set())
        if (synthMsg) {
          normalizedMessages.push(synthMsg)
          for (const id of missingIds) {
            synthesizedIds.add(id)
          }
        }
      }
    }
  }

  // 3. Final merge and part reordering for provider compatibility
  const merged = mergeSameRoles(normalizedMessages)

  return merged.map((msg) => {
    if (msg.role === 'assistant') {
      const toolCalls = msg.parts.filter((p) => p.type === 'tool_call')
      if (toolCalls.length > 0) {
        const others = msg.parts.filter((p) => p.type !== 'tool_call')
        return {
          ...msg,
          parts: [...others, ...toolCalls],
        }
      }
    }
    return msg
  })
}

/**
 * Creates a synthetic message containing cancellation results for any missing tool IDs.
 */
function createSyntheticResultMessage(
  expectedIds: string[],
  foundResults: Set<string>
): UnifiedMessage | null {
  const missingIds = expectedIds.filter((id) => !foundResults.has(id))

  if (missingIds.length === 0) {
    return null
  }

  const syntheticParts: ContentPart[] = missingIds.map((id) => ({
    type: 'tool_result',
    toolResult: {
      toolCallId: id,
      content: CANCELLATION_REASONS.USER_CANCELLED, // Defaulting to user cancelled as safe fallback
      isError: true,
    },
  }))

  return {
    role: 'user', // or 'tool' depending on unified semantics, usually 'tool' results come in 'user' or 'tool' role
    parts: syntheticParts,
  }
}
