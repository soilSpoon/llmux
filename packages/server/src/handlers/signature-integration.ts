/**
 * Signature Integration (Post-Transform)
 *
 * This module handles post-transform signature operations:
 * 1. Gemini: Normalize signatures (standardize to thought_signature, remove unsigned thinking)
 * 2. Claude: Layer 4 recovery (inject synthetic messages for tool loop)
 *
 * NOTE: Claude thinking block stripping is now handled in signature-request.ts (pre-transform).
 * This module no longer strips thinking for Claude.
 */

import crypto from 'node:crypto'
import { createLogger, getModelFamily } from '@llmux/core'
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
} from './thinking-recovery'
import { getThinkingStrategy } from './thinking-utils'
import type {
  ThinkingBlock as Block,
  ThinkingContent as Content,
  ConversationMessage,
  ThinkingMessage as Message,
  ThinkingPart as Part,
} from './types/thinking-types'

const logger = createLogger({ service: 'signature-integration' })

const SERVER_SESSION_ID = `server-${crypto.randomUUID()}`

// ============================================================================
// Types
// ============================================================================

export interface ConversationPayload {
  conversationId?: string
  conversation_id?: string
  thread_id?: string
  threadId?: string
  chat_id?: string
  chatId?: string
  sessionId?: string
  session_id?: string
  metadata?: {
    conversation_id?: string
    conversationId?: string
  }
  systemInstruction?: Content | { parts: Part[] } | string
  system?: Content | { parts: Part[] } | string
  system_instruction?: Content | { parts: Part[] } | string
  messages?: Message[]
  contents?: Content[]
  [key: string]: unknown
}

interface RequestWithContents {
  contents?: Content[]
  [key: string]: unknown
}

export interface UnifiedRequestBody {
  contents?: Content[]
  messages?: Message[]
  request?: RequestWithContents
  project?: string
  [key: string]: unknown
}

// ============================================================================
// Helpers
// ============================================================================

export function buildSignatureSessionKey(
  model?: string,
  conversationKey?: string,
  projectKey?: string
): string {
  const modelKey = typeof model === 'string' && model.trim() ? model.toLowerCase() : 'unknown'
  const projectPart =
    typeof projectKey === 'string' && projectKey.trim() ? projectKey.trim() : 'default'
  const conversationPart =
    typeof conversationKey === 'string' && conversationKey.trim()
      ? conversationKey.trim()
      : 'default'
  return `${SERVER_SESSION_ID}:${modelKey}:${projectPart}:${conversationPart}`
}

export function extractConversationKey(payload: Record<string, unknown>): string | undefined {
  const typedPayload = payload as ConversationPayload
  const candidates = [
    typedPayload.conversationId,
    typedPayload.conversation_id,
    typedPayload.thread_id,
    typedPayload.threadId,
    typedPayload.chat_id,
    typedPayload.chatId,
    typedPayload.sessionId,
    typedPayload.session_id,
    typedPayload.metadata?.conversation_id,
    typedPayload.metadata?.conversationId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  const systemText = extractTextFromSystem(
    typedPayload.systemInstruction ?? typedPayload.system ?? typedPayload.system_instruction
  )

  let messageText = ''
  if (Array.isArray(typedPayload.messages)) {
    const firstUser = typedPayload.messages.find((m) => m?.role === 'user')
    messageText = firstUser ? extractTextFromContent(firstUser.content) : ''
  } else if (Array.isArray(typedPayload.contents)) {
    const firstUser = typedPayload.contents.find((c) => c?.role === 'user')
    messageText = firstUser ? extractTextFromContent(firstUser.parts) : ''
  }

  const seed = [systemText, messageText].filter(Boolean).join('|')
  if (!seed) return undefined

  return `seed-${hashConversationSeed(seed)}`
}

function extractTextFromSystem(system: unknown): string {
  if (typeof system === 'string') return system
  if (!system || typeof system !== 'object') return ''

  if ('parts' in system && Array.isArray((system as Content).parts)) {
    return extractTextFromContent((system as Content).parts)
  }

  if ('text' in system && typeof (system as { text: string }).text === 'string') {
    return (system as { text: string }).text
  }

  return ''
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const typedBlock = block as Block | Part
    if (typeof typedBlock.text === 'string') return typedBlock.text
    if (typedBlock.text && typeof typedBlock.text === 'object' && 'text' in typedBlock.text) {
      return (typedBlock.text as { text: string }).text
    }
  }
  return ''
}

function hashConversationSeed(seed: string): string {
  return crypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 16)
}

export function shouldCacheSignatures(model?: string): boolean {
  if (typeof model !== 'string') return false
  const family = getModelFamily(model)
  if (family === 'openai') return false
  return family === 'claude' || family === 'gemini'
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Post-transform signature handling:
 * - Gemini: Normalize signatures (standardize field names, remove unsigned thinking)
 * - Claude: Layer 4 recovery only (thinking blocks already stripped in signature-request.ts)
 */
export function ensureThinkingSignatures(
  requestBody: Record<string, unknown>,
  sessionKey: string,
  model?: string,
  provider?: string
): void {
  const typedBody = requestBody as UnifiedRequestBody

  if (!model || !shouldCacheSignatures(model)) {
    return
  }

  const strategy = getThinkingStrategy(model, provider)

  // Step 1: Gemini signature normalization (Claude skips this - already clean)
  if (strategy === 'gemini-cache') {
    if (Array.isArray(typedBody.contents)) {
      typedBody.contents = normalizeGeminiContents(typedBody.contents)
    }
    if (Array.isArray(typedBody.messages)) {
      typedBody.messages = normalizeGeminiMessages(typedBody.messages)
    }

    if (typedBody.request && typeof typedBody.request === 'object') {
      const nestedRequest = typedBody.request as Record<string, unknown>
      if (Array.isArray(nestedRequest.contents)) {
        nestedRequest.contents = normalizeGeminiContents(nestedRequest.contents as Content[])
      }
      if (Array.isArray(nestedRequest.messages)) {
        nestedRequest.messages = normalizeGeminiMessages(nestedRequest.messages as Message[])
      }
    }

    logger.debug({ model, sessionKey }, 'Gemini: normalized signatures')
  }

  // Step 2: Claude Layer 4 recovery (tool loop fix)
  if (strategy === 'claude-fresh') {
    applyLayer4Recovery(typedBody, sessionKey, model)
  }
}

// ============================================================================
// Gemini Signature Normalization
// ============================================================================

const SKIP_THOUGHT_SIGNATURE_VALIDATOR = 'skip_thought_signature_validator'
const MIN_SIGNATURE_LENGTH = 50

function normalizeGeminiContents(contents: Content[]): Content[] {
  // Track the latest valid signature across all messages in the conversation
  let latestValidSignature: string | undefined

  return contents.map((content) => {
    if (!content || typeof content !== 'object') return content

    if (Array.isArray(content.parts)) {
      // First pass: capture any signatures from thinking blocks in this content
      for (const part of content.parts) {
        if (part && typeof part === 'object' && part.thought === true) {
          const sig = part.thought_signature || part.thoughtSignature || part.signature
          if (typeof sig === 'string' && sig.length >= MIN_SIGNATURE_LENGTH) {
            latestValidSignature = sig
          }
        }
      }

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

          // Standardize signature field to thought_signature for thinking blocks
          const signature = part.thought_signature || part.thoughtSignature || part.signature
          if (signature && part.thought === true) {
            const { thoughtSignature: _, signature: __, ...rest } = part
            return { ...rest, thought_signature: signature }
          }

          // For functionCall parts: ensure thought_signature is present
          // Gemini CLI API requires thought_signature on function calls after thinking
          if (part.functionCall) {
            const existingSig = part.thought_signature || part.thoughtSignature || part.signature
            if (!existingSig) {
              // Use the signature from preceding thinking block, or skip sentinel
              const effectiveSignature = latestValidSignature || SKIP_THOUGHT_SIGNATURE_VALIDATOR
              const { thoughtSignature: _, signature: __, ...rest } = part
              return { ...rest, thought_signature: effectiveSignature }
            } else {
              // Standardize existing signature field name
              const { thoughtSignature: _, signature: __, ...rest } = part
              return { ...rest, thought_signature: existingSig }
            }
          }

          return part
        })
      return { ...content, parts: filteredParts }
    }

    return content
  })
}

function normalizeGeminiMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message

    if (Array.isArray(message.content)) {
      const filteredContent = (message.content as Block[]).map((block) => {
        if (!block || typeof block !== 'object') return block
        // Standardize signature field to thought_signature
        const signature = block.thought_signature || block.signature || block.thoughtSignature
        if (signature) {
          const { signature: _, thoughtSignature: __, ...rest } = block
          return { ...rest, thought_signature: signature }
        }
        return block
      })
      return { ...message, content: filteredContent }
    }

    return message
  })
}

// ============================================================================
// Claude Layer 4 Recovery
// ============================================================================

function applyLayer4Recovery(
  typedBody: UnifiedRequestBody,
  sessionKey: string,
  model: string
): void {
  if (Array.isArray(typedBody.contents)) {
    const state = analyzeConversationState(typedBody.contents)
    if (needsThinkingRecovery(state)) {
      typedBody.contents = closeToolLoopForThinking(typedBody.contents)
      logger.info({ sessionKey, model }, 'Claude Layer 4: injected synthetic messages (contents)')
    }
  }

  if (Array.isArray(typedBody.messages)) {
    const state = analyzeConversationState(typedBody.messages)
    if (needsThinkingRecovery(state)) {
      typedBody.messages = closeToolLoopForThinking(typedBody.messages)
      logger.info({ sessionKey, model }, 'Claude Layer 4: injected synthetic messages (messages)')
    }
  }

  if (typedBody.request && typeof typedBody.request === 'object') {
    const nestedRequest = typedBody.request as Record<string, unknown>

    if (Array.isArray(nestedRequest.contents)) {
      const state = analyzeConversationState(nestedRequest.contents as ConversationMessage[])
      if (needsThinkingRecovery(state)) {
        nestedRequest.contents = closeToolLoopForThinking(
          nestedRequest.contents as ConversationMessage[]
        )
        logger.info(
          { sessionKey, model },
          'Claude Layer 4: injected synthetic messages (wrapped contents)'
        )
      }
    }

    if (Array.isArray(nestedRequest.messages)) {
      const state = analyzeConversationState(nestedRequest.messages as ConversationMessage[])
      if (needsThinkingRecovery(state)) {
        nestedRequest.messages = closeToolLoopForThinking(
          nestedRequest.messages as ConversationMessage[]
        )
        logger.info(
          { sessionKey, model },
          'Claude Layer 4: injected synthetic messages (wrapped messages)'
        )
      }
    }
  }
}
