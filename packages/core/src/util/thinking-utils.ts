import type { UnifiedMessage } from '../types/unified'

/**
 * Strips thinking blocks from conversation history.
 *
 * This is crucial for multi-turn conversations where previous thinking blocks
 * should not be leaked to subsequent turns, especially for providers like Anthropic
 * that strictly validate message structure.
 *
 * @param messages The conversation history
 * @returns A new array of messages with thinking blocks removed
 */
export function stripThinkingFromMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type !== 'thinking'),
  }))
}
