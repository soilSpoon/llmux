/**
 * ClaudeFreshStrategy
 *
 * Handles thinking blocks for Claude models with "fresh signature" approach:
 * - Pre-request: Strip ALL thinking blocks and signatures unconditionally
 * - Post-request: No normalization needed
 * - Recovery: Inject synthetic messages to close incomplete tool loops
 */

import type { SignatureStore } from '../../stores/signature-store'
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
} from '../thinking-recovery'
import {
  getSignatureFromBlock,
  getSignatureFromPart,
  isThinkingBlock,
  isThinkingPart,
} from '../thinking-utils'
import type {
  SignatureProcessResult,
  ThinkingContent,
  ThinkingMessage,
} from '../types/thinking-types'
import type { ThinkingStrategy } from './thinking-strategy'
import { registerThinkingStrategy } from './thinking-strategy'

export class ClaudeFreshStrategy implements ThinkingStrategy {
  readonly name = 'claude-fresh' as const

  processRequestContents(
    contents: ThinkingContent[],
    _projectId: string,
    _signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingContent> {
    let strippedCount = 0

    const processed = contents.map((content) => {
      if (!content || typeof content !== 'object') return content
      if (!Array.isArray(content.parts)) return content

      const filteredParts = content.parts
        .map((part) => {
          if (!part || typeof part !== 'object') return part

          // Remove ALL thinking parts
          if (isThinkingPart(part)) {
            strippedCount++
            return {} // Will be filtered out
          }

          // Strip signature fields from non-thinking parts
          const sig = getSignatureFromPart(part)
          if (sig) {
            strippedCount++
            const { thoughtSignature, thought_signature, signature, ...rest } = part
            return rest
          }

          return part
        })
        .filter((part) => {
          if (!part || typeof part !== 'object') return true
          return Object.keys(part).length > 0
        })

      return { ...content, parts: filteredParts }
    })

    return { processed, strippedCount }
  }

  processRequestMessages(
    messages: ThinkingMessage[],
    _projectId: string,
    _signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingMessage> {
    let strippedCount = 0

    const processed = messages.map((message) => {
      if (!message || typeof message !== 'object') return message
      if (typeof message.content === 'string' || !Array.isArray(message.content)) {
        return message
      }

      const filteredContent = message.content
        .map((block) => {
          if (!block || typeof block !== 'object') return block

          // Remove ALL thinking blocks
          if (isThinkingBlock(block)) {
            strippedCount++
            return {} // Will be filtered out
          }

          // Strip signature fields from non-thinking blocks
          const sig = getSignatureFromBlock(block)
          if (sig) {
            strippedCount++
            const { signature, thoughtSignature, thought_signature, ...rest } = block
            return rest
          }

          return block
        })
        .filter((block) => {
          if (!block || typeof block !== 'object') return true
          return Object.keys(block).length > 0
        })

      return { ...message, content: filteredContent }
    })

    return { processed, strippedCount }
  }

  normalizeResponseContents(contents: ThinkingContent[]): ThinkingContent[] {
    // Claude Fresh doesn't need response normalization - blocks were stripped pre-request
    return contents
  }

  normalizeResponseMessages(messages: ThinkingMessage[]): ThinkingMessage[] {
    // Claude Fresh doesn't need response normalization
    return messages
  }

  recoverConversation<T extends ThinkingContent | ThinkingMessage>(contents: T[]): T[] {
    const state = analyzeConversationState(contents)
    if (needsThinkingRecovery(state)) {
      return closeToolLoopForThinking(contents) as T[]
    }
    return contents
  }
}

// Register the strategy
const claudeFreshStrategy = new ClaudeFreshStrategy()
registerThinkingStrategy(claudeFreshStrategy)

export { claudeFreshStrategy }
