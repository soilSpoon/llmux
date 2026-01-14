import type { StopReason } from '../../types/unified'

// SSE event format helper
export const SSE_EVENT_DELIMITER = '\n\n'

export function formatSSEEvent(eventType: string, data: unknown): string {
  const jsonData = typeof data === 'string' ? data : JSON.stringify(data)
  return `event: ${eventType}\ndata: ${jsonData}${SSE_EVENT_DELIMITER}`
}

/**
 * Check if a value is a valid StopReason
 */
function isStopReason(value: unknown): value is StopReason {
  const validReasons: readonly StopReason[] = [
    'end_turn',
    'max_tokens',
    'tool_use',
    'stop_sequence',
    'content_filter',
    'error',
    null,
  ]
  return validReasons.includes(value as StopReason)
}

/**
 * Map provider-specific stop reasons to unified StopReason type.
 * Handles Anthropic, Gemini, OpenAI, and other provider stop reasons.
 */
export function mapToStopReason(providerReason: string | null | undefined): StopReason {
  if (!providerReason) return 'end_turn'

  if (isStopReason(providerReason)) {
    return providerReason
  }

  // Anthropic & Antigravity
  if (providerReason === 'end_turn' || providerReason === 'message_stop') {
    return 'end_turn'
  }
  if (providerReason === 'tool_use') {
    return 'tool_use'
  }
  if (providerReason === 'max_tokens') {
    return 'max_tokens'
  }
  if (providerReason === 'stop_sequence') {
    return 'stop_sequence'
  }

  // Gemini
  if (providerReason === 'FINISH_REASON_UNSPECIFIED') {
    return 'end_turn'
  }
  if (providerReason === 'STOP') {
    return 'stop_sequence'
  }
  if (providerReason === 'MAX_TOKENS') {
    return 'max_tokens'
  }
  if (providerReason === 'SAFETY' || providerReason === 'RECITATION') {
    return 'content_filter'
  }

  // Default fallback
  return 'end_turn'
}
