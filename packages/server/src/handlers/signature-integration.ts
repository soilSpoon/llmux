/**
 * Thinking Strategy for Multi-turn Claude Conversations (opencode-antigravity-auth)
 *
 * This module implements the "strip all thinking" strategy to handle Claude thinking models
 * with large tool sets. Instead of trying to restore thinking signatures (which often breaks
 * with many tools), it:
 * 1. Strips all thinking blocks from previous model messages in subsequent requests.
 * 2. Injects synthetic messages for tool loop recovery (Layer 4) when thinking is needed but missing.
 */

import crypto from 'node:crypto'
import { createLogger, getModelFamily } from '@llmux/core'
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
} from './thinking-recovery'

const logger = createLogger({ service: 'signature-integration' })

/**
 * The stable session ID for this server instance.
 * Reset on server restart.
 */
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

export interface Message {
  role?: string
  content?: Block[] | string
  [key: string]: unknown
}

export interface Content {
  role?: string
  parts?: Part[]
  [key: string]: unknown
}

export interface Block {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  thought_signature?: string
  thoughtSignature?: string
  [key: string]: unknown
}

export interface Part {
  text?: string
  thought?: boolean
  thought_signature?: string
  thoughtSignature?: string
  type?: string
  signature?: string
  thinking?: string
  functionCall?: unknown
  tool_use?: unknown
  toolUse?: unknown
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

/**
 * Build a session key for signature caching.
 * Combines server session ID, model, and optional conversation/project keys.
 */
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

/**
 * Extract a conversation key from request payload.
 * Looks for common conversation ID fields.
 */
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

  // Generate seed from system instruction + first user message
  const systemText = extractTextFromSystem(
    typedPayload.systemInstruction ??
      typedPayload.system ?? // system_instruction alias handles system_instruction
      typedPayload.system_instruction
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

/**
 * Check if a model should use signature caching.
 * Supports Claude thinking models and Gemini models with thinking support.
 */
export function shouldCacheSignatures(model?: string): boolean {
  if (typeof model !== 'string') return false

  const family = getModelFamily(model)

  // Blacklist OpenAI - it throws 400 Bad Request when unknown fields (thoughtSignature) are present
  if (family === 'openai') {
    return false
  }

  // Gemini 2.0+ requires thoughtSignature when thinking mode is active
  // Claude thinking models also require signature caching
  // Both families need this for proper tool-use with thinking
  return family === 'claude' || family === 'gemini'
}

// ============================================================================
// Request-side: Restore signatures to thinking blocks
// ============================================================================

/**
 * Ensure thinking blocks in the request have proper signatures.
 * Follows OpenCode v2.0 strategy with 3-layer defense:
 * 1. Strip ALL thinking blocks first (prevents corruption)
 * 2. Selectively inject cached thinking (Layer 1: session, Layer 2: global)
 * 3. If still no thinking in tool loop, separate turn (Layer 3/4)
 *
 * Modifies the request body in place.
 */
export function ensureThinkingSignatures(
  requestBody: Record<string, unknown>,
  sessionKey: string,
  model?: string
): void {
  const typedBody = requestBody as UnifiedRequestBody

  // Only process for models that need signature caching
  if (!model || !shouldCacheSignatures(model)) {
    return
  }

  const modelFamily = getModelFamily(model)

  // STEP 1: Process signature stripping/standardization
  // Strategy:
  // - Claude: Strip ALL thinking blocks (prevents corruption, Layer 4 recovery handles loop)
  // - Gemini: Preserve thinking blocks (required for validation) but standardize signatures
  const isClaude = modelFamily === 'claude'

  if (Array.isArray(typedBody.contents)) {
    typedBody.contents = processSignaturesInContents(typedBody.contents, isClaude)
  }
  if (Array.isArray(typedBody.messages)) {
    typedBody.messages = processSignaturesInMessages(typedBody.messages, isClaude)
  }

  // Handle wrapped request format (Antigravity)
  if (typedBody.request && typeof typedBody.request === 'object') {
    const nestedRequest = typedBody.request as Record<string, unknown>
    if (Array.isArray(nestedRequest.contents)) {
      nestedRequest.contents = processSignaturesInContents(nestedRequest.contents, isClaude)
    }
    if (Array.isArray(nestedRequest.messages)) {
      nestedRequest.messages = processSignaturesInMessages(nestedRequest.messages, isClaude)
    }
  }

  logger.debug({ model, sessionKey, isClaude }, 'Step 1: Processed thinking signatures')

  // ==========================================================================
  // STEP 2: Apply Layer 4 recovery for Claude models if needed
  // If we're in an incomplete tool loop without thinking, inject synthetic
  // MODEL + USER messages to start a new turn for fresh thinking generation
  // ==========================================================================

  if (modelFamily === 'claude') {
    // Check for tool loop recovery on top-level contents
    if (Array.isArray(typedBody.contents)) {
      const state = analyzeConversationState(typedBody.contents)
      if (needsThinkingRecovery(state)) {
        typedBody.contents = closeToolLoopForThinking(typedBody.contents)
        logger.info(
          { sessionKey, model },
          'Applied Layer 4 recovery: injected synthetic messages for tool loop (contents)'
        )
      }
    }

    // Check for tool loop recovery on top-level messages
    if (Array.isArray(typedBody.messages)) {
      const state = analyzeConversationState(typedBody.messages)
      if (needsThinkingRecovery(state)) {
        typedBody.messages = closeToolLoopForThinking(typedBody.messages)
        logger.info(
          { sessionKey, model },
          'Applied Layer 4 recovery: injected synthetic messages for tool loop (messages)'
        )
      }
    }

    // Check for tool loop recovery on wrapped request format
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
            'Applied Layer 4 recovery: injected synthetic messages for tool loop (wrapped contents)'
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
            'Applied Layer 4 recovery: injected synthetic messages for tool loop (wrapped messages)'
          )
        }
      }
    }
  }
}

/**
 * Helper type for thinking recovery
 */
interface ConversationMessage {
  role?: string
  parts?: Array<{ [key: string]: unknown }>
  content?: Array<{ [key: string]: unknown }> | string
  [key: string]: unknown
}

/**
 * Process signatures in contents (model-aware).
 * - If stripThinking is true (Claude), removes all thinking blocks.
 * - Otherwise (Gemini), removes unsigned thinking blocks and standardizes signatures.
 */
function processSignaturesInContents(contents: Content[], stripThinking: boolean): Content[] {
  return contents.map((content) => {
    if (!content || typeof content !== 'object') return content

    if (Array.isArray(content.parts)) {
      const filteredParts = content.parts
        .filter((part) => {
          if (!part || typeof part !== 'object') return true
          const p = part as Part
          if (stripThinking) {
            // Claude behavior: remove thinking parts
            return !(
              p.thought === true ||
              p.type === 'thinking' ||
              p.type === 'reasoning' ||
              p.type === 'redacted_thinking'
            )
          }
          // Gemini behavior: remove unsigned thinking blocks
          if (p.thought === true) {
            const hasSignature = p.thought_signature || p.thoughtSignature || p.signature
            return !!hasSignature
          }
          return true
        })
        .map((part) => {
          if (!part || typeof part !== 'object') return part
          const p = part as Part

          if (stripThinking) {
            // Claude behavior: remove all residual signature fields
            const { thoughtSignature: _, signature: __, thought_signature: ___, ...rest } = p
            return rest
          }

          // Gemini behavior: standardize on thought_signature (snake_case)
          const signature = p.thought_signature || p.thoughtSignature || p.signature
          if (signature) {
            const { thoughtSignature: _, signature: __, ...rest } = p
            return {
              ...rest,
              thought_signature: signature,
            }
          }

          return part
        })
      return { ...content, parts: filteredParts }
    }

    return content
  })
}

/**
 * Process signatures in messages (model-aware).
 */
function processSignaturesInMessages(messages: Message[], stripThinking: boolean): Message[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message

    if (Array.isArray(message.content)) {
      const filteredContent = (message.content as Block[])
        .filter((block) => {
          if (!block || typeof block !== 'object') return true
          const b = block as Block
          if (stripThinking) {
            // Claude: remove thinking blocks
            return !(b.type === 'thinking' || b.type === 'redacted_thinking')
          }
          return true
        })
        .map((block) => {
          if (!block || typeof block !== 'object') return block
          const b = block as Block

          if (stripThinking) {
            // Claude: remove all residual signature fields
            const { signature: _, thoughtSignature: __, thought_signature: ___, ...rest } = b
            return rest
          }

          // Gemini behavior: standardize on thought_signature (snake_case)
          const signature = b.thought_signature || b.signature || b.thoughtSignature
          if (signature) {
            const { signature: _, thoughtSignature: __, ...rest } = b
            return {
              ...rest,
              thought_signature: signature,
            }
          }

          return block
        })
      return { ...message, content: filteredContent }
    }

    return message
  })
}
