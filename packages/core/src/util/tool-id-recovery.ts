import type { UnifiedMessage } from '../types/unified.js'

/**
 * US-015: Orphan Tool ID Recovery
 *
 * Context compaction 등으로 인해 tool ID가 불일치할 때,
 * 함수명을 기반으로 ID를 매칭하여 복구합니다.
 */

export function recoverToolIds(messages: UnifiedMessage[]): UnifiedMessage[] {
  const allCalls = messages.flatMap((m) =>
    m.role === 'assistant' ? m.parts.filter((p) => p.type === 'tool_call') : []
  )

  const callMap = new Map<string, string>() // ID -> name
  for (const call of allCalls) {
    if (call.toolCall?.id) {
      callMap.set(call.toolCall.id, call.toolCall.name)
    }
  }

  // 매칭되지 않은 call들의 ID 리스트
  const unmatchedCallIds = new Set(callMap.keys())

  return messages.map((msg) => {
    if (msg.role !== 'tool') return msg

    return {
      ...msg,
      parts: msg.parts.map((part) => {
        if (part.type === 'tool_result' && part.toolResult) {
          const currentId = part.toolResult.toolCallId

          // 1. 이미 정확히 매칭되는 경우
          if (unmatchedCallIds.has(currentId)) {
            // unmatchedCallIds.delete(currentId); // 중복 매칭 허용 여부에 따라 결정
            return part
          }

          // 2. ID가 틀린 경우, 남은 call 중 하나와 매칭 시도
          // (함수명 정보가 결과에 있으면 좋겠지만, 없으면 순서대로 매칭)
          const firstAvailableId = Array.from(unmatchedCallIds)[0]
          if (firstAvailableId) {
            unmatchedCallIds.delete(firstAvailableId)
            return {
              ...part,
              toolResult: {
                ...part.toolResult,
                toolCallId: firstAvailableId,
              },
            }
          }
        }
        return part
      }),
    }
  })
}
