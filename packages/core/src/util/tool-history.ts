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

  const normalizedMessages: UnifiedMessage[] = []

  // Track open tool calls: Map<toolCallId, { messageIndex, callIndex, toolCall }>
  const openToolCalls = new Map<
    string,
    {
      toolName: string
      id: string
    }
  >()

  // Track results found: Set<toolCallId>
  const foundResults = new Set<string>()

  // 1. First pass: Identify all tool calls and results
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call' && part.toolCall) {
        openToolCalls.set(part.toolCall.id, {
          toolName: part.toolCall.name,
          id: part.toolCall.id,
        })
      } else if (part.type === 'tool_result' && part.toolResult) {
        foundResults.add(part.toolResult.toolCallId)
      }
    }
  }

  // 2. Second pass: Reconstruct messages, fixing open loops and grouping
  let pendingToolGroup: {
    message: UnifiedMessage
    callIds: string[]
  } | null = null

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (!message) {
      continue
    }

    // Assistant message with tool calls?
    const toolCallParts = message.parts.filter((p) => p.type === 'tool_call')
    if (message.role === 'assistant' && toolCallParts.length > 0) {
      // If we have a pending group from before (shouldn't happen in well-formed history but safety first)
      if (pendingToolGroup) {
        // Force close previous group if not closed
        const synthResultMsg = createSyntheticResultMessage(pendingToolGroup.callIds, foundResults)
        if (synthResultMsg) {
          normalizedMessages.push(synthResultMsg)
        }
        pendingToolGroup = null
      }

      const currentCallIds = toolCallParts
        .map((p) => p.toolCall?.id)
        .filter((id): id is string => id !== undefined)
      pendingToolGroup = {
        message,
        callIds: currentCallIds,
      }
      normalizedMessages.push(message)
      continue
    }

    // User message with tool results?
    const toolResultParts = message.parts.filter((p) => p.type === 'tool_result')
    if (message.role === 'tool' || (message.role === 'user' && toolResultParts.length > 0)) {
      // If no pending group, this might be an orphan result or a result for a far-back call
      // For now, we just pass it through, assuming standard ordering assistant -> tool
      if (pendingToolGroup) {
        // Check if this message closes the pending group
        const resultsInThisMessage = toolResultParts
          .map((p) => p.toolResult?.toolCallId)
          .filter((id): id is string => id !== undefined)

        // Add valid results to found set for this group
        for (const id of resultsInThisMessage) {
          foundResults.add(id)
        }

        // We don't push yet, we might need to merge or fill gaps
        // But for simple normalization, we just push the user message
        normalizedMessages.push(message)

        // Check if pending group is fully satisfied
        const allSatisfied = pendingToolGroup.callIds.every((id) => foundResults.has(id))
        if (allSatisfied) {
          pendingToolGroup = null
        }
      } else {
        // Orphan result or result without immediate preceding call
        normalizedMessages.push(message)
      }
      continue
    }

    // Regular message (text, image, etc.)
    // If we have a pending tool group that is NOT closed, we must close it before this text message
    if (pendingToolGroup) {
      const synthResultMsg = createSyntheticResultMessage(pendingToolGroup.callIds, foundResults)

      if (synthResultMsg) {
        // Insert synthetic results to close the loop
        normalizedMessages.push(synthResultMsg)
      }
      pendingToolGroup = null
    }

    normalizedMessages.push(message)
  }

  // 3. Final cleanup: If we ended with an open pending group
  if (pendingToolGroup) {
    const synthResultMsg = createSyntheticResultMessage(pendingToolGroup.callIds, foundResults)
    if (synthResultMsg) {
      normalizedMessages.push(synthResultMsg)
    }
  }

  return normalizedMessages
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
