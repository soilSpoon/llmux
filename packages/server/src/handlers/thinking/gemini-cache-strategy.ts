/**
 * GeminiCacheStrategy
 *
 * Handles thinking blocks for Gemini models with "cache signature" approach:
 * - Pre-request: Always preserve signatures (projectId validation skipped due to account rotation)
 * - Post-request: Normalize signature field names to thought_signature, remove unsigned thinking
 * - Recovery: Not typically needed
 */

import type { SignatureStore } from '../../stores/signature-store'
import { getSignatureFromBlock, getSignatureFromPart } from '../thinking-utils'
import type {
  SignatureProcessResult,
  ThinkingBlock,
  ThinkingContent,
  ThinkingMessage,
} from '../types/thinking-types'
import type { ThinkingStrategy } from './thinking-strategy'
import { registerThinkingStrategy } from './thinking-strategy'

export class GeminiCacheStrategy implements ThinkingStrategy {
  readonly name = 'gemini-cache' as const

  processRequestContents(
    contents: ThinkingContent[],
    _projectId: string,
    _signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingContent> {
    // Gemini Cache: Always preserve signatures (projectId validation skipped)
    // This is crucial because llmux rotates accounts (and thus projectIds)
    // but the signature must be preserved to maintain the thinking trace.
    return { processed: contents, strippedCount: 0 }
  }

  processRequestMessages(
    messages: ThinkingMessage[],
    _projectId: string,
    _signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingMessage> {
    // Gemini Cache: Always preserve signatures
    return { processed: messages, strippedCount: 0 }
  }

  normalizeResponseContents(contents: ThinkingContent[]): ThinkingContent[] {
    return contents.map((content) => {
      if (!content || typeof content !== 'object') return content
      if (!Array.isArray(content.parts)) return content

      const filteredParts = content.parts
        .filter((part) => {
          if (!part || typeof part !== 'object') return true
          // Remove unsigned thinking blocks
          if (part.thought === true) {
            const hasSignature = part.thought_signature || part.thoughtSignature || part.signature
            return !!hasSignature
          }
          return true
        })
        .map((part) => {
          if (!part || typeof part !== 'object') return part
          // Standardize signature field to thought_signature
          const signature = getSignatureFromPart(part)
          if (signature && part.thought === true) {
            const { thoughtSignature, signature: _sig, ...rest } = part
            return { ...rest, thought_signature: signature }
          }
          return part
        })

      return { ...content, parts: filteredParts }
    })
  }

  normalizeResponseMessages(messages: ThinkingMessage[]): ThinkingMessage[] {
    return messages.map((message) => {
      if (!message || typeof message !== 'object') return message
      if (typeof message.content === 'string' || !Array.isArray(message.content)) {
        return message
      }

      const normalizedContent = (message.content as ThinkingBlock[]).map((block) => {
        if (!block || typeof block !== 'object') return block
        // Standardize signature field to thought_signature
        const signature = getSignatureFromBlock(block)
        if (signature) {
          const { signature: _sig, thoughtSignature, ...rest } = block
          return { ...rest, thought_signature: signature }
        }
        return block
      })

      return { ...message, content: normalizedContent }
    })
  }

  recoverConversation<T extends ThinkingContent | ThinkingMessage>(contents: T[]): T[] {
    // Gemini typically doesn't need tool loop recovery
    return contents
  }
}

// Register the strategy
const geminiCacheStrategy = new GeminiCacheStrategy()
registerThinkingStrategy(geminiCacheStrategy)

export { geminiCacheStrategy }
