/**
 * Signature Request Validation
 *
 * Pre-transform signature handling:
 * - Claude (Fresh Signature): Strip ALL thinking blocks and signatures unconditionally
 * - Other models: Validate signatures against SignatureStore, strip if project mismatch
 */

import { createLogger } from '@llmux/core'
import type { SignatureStore } from '../stores/signature-store'
import {
  type Content,
  getSignatureFromBlock,
  getSignatureFromPart,
  getThinkingStrategy,
  isThinkingBlock,
  isThinkingPart,
  isToolResultBlock,
  isToolResultPart,
  isToolUseBlock,
  isToolUsePart,
  type Message,
  stripSignatureFromBlock,
  stripSignatureFromPart,
} from './thinking-utils'

export type {
  ThinkingBlock as Block,
  ThinkingContent as Content,
  ThinkingMessage as Message,
  ThinkingPart as Part,
} from './types/thinking-types'

const logger = createLogger({ service: 'signature-request' })

export interface ValidateSignatureOptions {
  contents?: Content[]
  messages?: Message[]
  targetProjectId: string
  signatureStore: SignatureStore
  model?: string
}

export interface ValidateSignatureResult {
  contents?: Content[]
  messages?: Message[]
  strippedCount: number
}

export function validateAndStripSignatures(
  options: ValidateSignatureOptions
): ValidateSignatureResult {
  const { contents, messages, targetProjectId, signatureStore, model } = options
  let strippedCount = 0

  const strategy = getThinkingStrategy(model)
  const isClaudeFresh = strategy === 'claude-fresh'
  const isGeminiCache = strategy === 'gemini-cache'

  const processedContents = contents
    ? processContents(
        contents,
        targetProjectId,
        signatureStore,
        isClaudeFresh,
        isGeminiCache,
        (count) => {
          strippedCount += count
        }
      )
    : undefined

  const processedMessages = messages
    ? processMessages(
        messages,
        targetProjectId,
        signatureStore,
        isClaudeFresh,
        isGeminiCache,
        (count) => {
          strippedCount += count
        }
      )
    : undefined

  if (strippedCount > 0 && isClaudeFresh) {
    logger.debug({ model, strippedCount }, 'Claude Fresh Signature: stripped thinking blocks')
  }

  return {
    contents: processedContents,
    messages: processedMessages,
    strippedCount,
  }
}

function processContents(
  contents: Content[],
  targetProjectId: string,
  signatureStore: SignatureStore,
  isClaudeFresh: boolean,
  isGeminiCache: boolean,
  onStrip: (count: number) => void
): Content[] {
  return contents.map((content) => {
    if (!content || typeof content !== 'object') return content

    if (!Array.isArray(content.parts)) {
      return content
    }

    const processedParts = content.parts
      .map((part) => {
        if (!part || typeof part !== 'object') return part

        // PROTECTION: Never strip tool_use or tool_result parts
        if (isToolUsePart(part) || isToolResultPart(part)) {
          return part
        }

        // Claude Fresh Signature: Remove ALL thinking parts
        if (isClaudeFresh && isThinkingPart(part)) {
          onStrip(1)
          return {} // Will be filtered out
        }

        // Claude Fresh Signature: Also strip any signature fields from non-thinking parts
        if (isClaudeFresh) {
          const sig = getSignatureFromPart(part)
          if (sig) {
            onStrip(1)
            return stripSignatureFromPart(part)
          }
          return part
        }

        // Gemini Cache: Always preserve signature (projectId validation skipped)
        // This is crucial because llmux rotates accounts (and thus projectIds)
        // but the signature must be preserved to maintain the thinking trace.
        if (isGeminiCache) {
          return part
        }

        // Other models: Project-based signature validation
        const signature = getSignatureFromPart(part)
        if (!signature) return part

        if (!signatureStore.isValidForProject(signature, targetProjectId)) {
          const record = signatureStore.getRecord(signature)
          const storedProjectId = record?.projectId ?? 'unknown'

          logger.trace(
            { storedProjectId, targetProjectId, signaturePrefix: signature.slice(0, 20) },
            'Stripped invalid signature (project mismatch)'
          )

          onStrip(1)
          return stripSignatureFromPart(part)
        }

        return part
      })
      .filter((part) => {
        if (!part || typeof part !== 'object') return true
        return Object.keys(part).length > 0
      })

    return { ...content, parts: processedParts }
  })
}

function processMessages(
  messages: Message[],
  targetProjectId: string,
  signatureStore: SignatureStore,
  isClaudeFresh: boolean,
  isGeminiCache: boolean,
  onStrip: (count: number) => void
): Message[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message

    if (typeof message.content === 'string' || !Array.isArray(message.content)) {
      return message
    }

    const processedContent = message.content
      .map((block) => {
        if (!block || typeof block !== 'object') return block

        // PROTECTION: Never strip tool_use or tool_result blocks
        if (isToolUseBlock(block) || isToolResultBlock(block)) {
          return block
        }

        // Claude Fresh Signature: Remove ALL thinking blocks
        if (isClaudeFresh && isThinkingBlock(block)) {
          onStrip(1)
          return {} // Will be filtered out
        }

        // Claude Fresh Signature: Also strip any signature fields from non-thinking blocks
        if (isClaudeFresh) {
          const sig = getSignatureFromBlock(block)
          if (sig) {
            onStrip(1)
            return stripSignatureFromBlock(block)
          }
          return block
        }

        // Gemini Cache: Always preserve signature (projectId validation skipped)
        // This is crucial because llmux rotates accounts (and thus projectIds)
        // but the signature must be preserved to maintain the thinking trace.
        if (isGeminiCache) {
          return block
        }

        // Other models: Project-based signature validation
        const signature = getSignatureFromBlock(block)
        if (!signature) return block

        if (!signatureStore.isValidForProject(signature, targetProjectId)) {
          const record = signatureStore.getRecord(signature)
          const storedProjectId = record?.projectId ?? 'unknown'

          logger.trace(
            { storedProjectId, targetProjectId, signaturePrefix: signature.slice(0, 20) },
            'Stripped invalid signature (project mismatch)'
          )

          onStrip(1)
          return stripSignatureFromBlock(block)
        }

        return block
      })
      .filter((block) => {
        if (!block || typeof block !== 'object') return true
        return Object.keys(block).length > 0
      })

    return { ...message, content: processedContent }
  })
}
