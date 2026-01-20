import type { JsonObject } from './json-schema.js'
import type { ContentPart, UnifiedMessage } from './unified.js'

/**
 * US-014: Tool Edge Graph 모델링
 */

export interface ToolCallEdge {
  id: string
  name: string
  arguments: JsonObject | string
  issuedAtMessageIndex: number
}

export interface ToolResultEdge {
  toolCallId: string
  content: string | ContentPart[]
  status: 'success' | 'error'
  producedAtMessageIndex: number
}

/**
 * 모든 ToolResult가 대응하는 ToolCall을 가리키는지 검증합니다.
 */
export function validateToolEdges(calls: ToolCallEdge[], results: ToolResultEdge[]): string[] {
  const errors: string[] = []
  const callIds = new Set(calls.map((c) => c.id))

  for (const res of results) {
    if (!callIds.has(res.toolCallId)) {
      errors.push(`Orphaned tool result found for call ID: ${res.toolCallId}`)
    }
  }

  return errors
}

/**
 * Claude의 엄격한 인접성 규칙(Strict Adjacency)을 준수하도록 메시지를 재배치합니다.
 * Rule: assistant(tool_use) 바로 다음에 user(tool_result)가 위치해야 함.
 */
export function linearizeForClaude(messages: UnifiedMessage[]): UnifiedMessage[] {
  const result: UnifiedMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue

    result.push(msg)

    // assistant 메시지에 tool_call이 포함되어 있는지 확인
    const toolCalls = msg.parts.filter((p) => p.type === 'tool_call')
    if (msg.role === 'assistant' && toolCalls.length > 0) {
      const callIds = toolCalls
        .map((p) => p.toolCall?.id)
        .filter((id): id is string => id !== undefined)

      const resultsForCalls: ContentPart[] = []

      // 이후 메시지들을 탐색하며 대응하는 결과 수집
      for (let j = i + 1; j < messages.length; j++) {
        const futureMsg = messages[j]
        if (!futureMsg) continue

        if (futureMsg.role === 'tool') {
          const matchingParts = futureMsg.parts.filter(
            (p) => p.type === 'tool_result' && callIds.includes(p.toolResult?.toolCallId || '')
          )

          if (matchingParts.length > 0) {
            resultsForCalls.push(...matchingParts)
          }
        }
      }

      if (resultsForCalls.length > 0) {
        // Claude 규칙: tool_result 순서를 tool_call 순서에 맞춤
        resultsForCalls.sort((a, b) => {
          const idA = a.toolResult?.toolCallId || ''
          const idB = b.toolResult?.toolCallId || ''
          return callIds.indexOf(idA) - callIds.indexOf(idB)
        })

        result.push({
          role: 'user',
          parts: resultsForCalls,
        })
      }
    }
  }

  return cleanupLinearizedMessages(result)
}

function cleanupLinearizedMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  const final: UnifiedMessage[] = []
  const seenResultIds = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'tool') {
      continue
    }

    if (msg.role === 'user') {
      const parts = msg.parts.filter((p) => {
        if (p.type === 'tool_result') {
          const id = p.toolResult?.toolCallId || ''
          if (seenResultIds.has(id)) return false
          seenResultIds.add(id)
          return true
        }
        return true
      })

      if (parts.length > 0) {
        final.push({ ...msg, parts })
      }
    } else {
      final.push(msg)
    }
  }

  return final
}
