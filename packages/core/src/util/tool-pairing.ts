import { linearizeForClaude } from '../types/tool-edge.js'
import type { ContentPart, UnifiedMessage } from '../types/unified.js'

/**
 * US-001: Tool Pairing Adjacency 강제 모듈
 */

export function enforceToolPairingAdjacency(
  messages: UnifiedMessage[],
  strict: boolean
): UnifiedMessage[] {
  // 1. 모든 tool call에 ID 보장
  const messagesWithIds = assignToolIds(messages)

  if (!strict) {
    // Even if not strict (Gemini), we MUST merge same-role messages
    // as Gemini requires strict alternation (User <-> Model)
    return mergeSameRoles(messagesWithIds)
  }

  // 2. 누락된 결과 합성
  const messagesWithSynthesizedResults = synthesizeMissingResults(messagesWithIds)

  // 3. 선형화 (strict adjacency)
  const linearized = linearizeForClaude(messagesWithSynthesizedResults)

  // 4. Merge consecutive same-role messages
  return mergeSameRoles(linearized)
}

function mergeSameRoles(messages: UnifiedMessage[]): UnifiedMessage[] {
  const merged: UnifiedMessage[] = []

  for (const msg of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === msg.role) {
      last.parts.push(...msg.parts)
    } else {
      merged.push({ ...msg, parts: [...msg.parts] })
    }
  }

  return merged
}

function assignToolIds(messages: UnifiedMessage[]): UnifiedMessage[] {
  let counter = 0
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.map((part) => {
      if (part.type === 'tool_call' && part.toolCall && !part.toolCall.id) {
        return {
          ...part,
          toolCall: {
            ...part.toolCall,
            id: `call_${Date.now()}_${counter++}`,
          },
        }
      }
      return part
    }),
  }))
}

function synthesizeMissingResults(messages: UnifiedMessage[]): UnifiedMessage[] {
  const allCalls = messages.flatMap((m) => m.parts.filter((p) => p.type === 'tool_call'))
  const allResultIds = new Set(
    messages
      .flatMap((m) => m.parts.filter((p) => p.type === 'tool_result'))
      .map((p) => p.toolResult?.toolCallId)
      .filter((id): id is string => id !== undefined)
  )

  const missingCalls = allCalls.filter((p) => !allResultIds.has(p.toolCall?.id || ''))

  if (missingCalls.length === 0) {
    return messages
  }

  const synthesizedParts: ContentPart[] = missingCalls.map((p) => ({
    type: 'tool_result',
    toolResult: {
      toolCallId: p.toolCall?.id || 'unknown',
      content: `Tool execution cancelled or result missing for ${p.toolCall?.name}`,
      isError: true,
    },
  }))

  const synthesizedMessage: UnifiedMessage = {
    role: 'tool',
    parts: synthesizedParts,
  }

  return [...messages, synthesizedMessage]
}
