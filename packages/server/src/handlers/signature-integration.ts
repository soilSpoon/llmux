/**
 * Signature Integration for Multi-turn Claude Thinking Conversations
 *
 * This module integrates SignatureCache with streaming handlers to:
 * 1. Cache thoughtSignatures from streaming responses
 * 2. Restore signatures to thinking blocks in subsequent requests
 */

import crypto from 'node:crypto'
import { type CacheKey, createLogger, createTextHash, SignatureCache } from '@llmux/core'

const logger = createLogger({ service: 'signature-integration' })

// Singleton cache instance for the server
const signatureCache = new SignatureCache({
  ttl: 60 * 60 * 1000, // 1 hour
  maxEntriesPerSession: 100,
})

// Fallback: Last signed thinking per session key (for tool use cases)
const lastSignedThinkingBySessionKey = new Map<string, { text: string; signature: string }>()

const MIN_SIGNATURE_LENGTH = 50

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
  [key: string]: unknown
}

export interface Part {
  text?: string
  thought?: boolean
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
 * Check if a model should use signature caching (Claude thinking models).
 */
export function shouldCacheSignatures(model?: string): boolean {
  if (typeof model !== 'string') return false
  const lower = model.toLowerCase()
  return lower.includes('claude') && lower.includes('thinking')
}

// ============================================================================
// Response-side: Cache signatures from streaming responses
// ============================================================================

/**
 * Process a streaming chunk and cache any thoughtSignatures found.
 * Call this for each transformed chunk in the streaming handler.
 */
export function cacheSignatureFromChunk(
  sessionKey: string,
  chunkData: {
    thinking?: { text?: string; signature?: string }
  },
  thoughtBuffer: Map<number, string>,
  candidateIndex = 0
): void {
  if (!chunkData.thinking) return

  const { text, signature } = chunkData.thinking

  // Accumulate thinking text
  if (text) {
    const current = thoughtBuffer.get(candidateIndex) ?? ''
    thoughtBuffer.set(candidateIndex, current + text)
  }

  // Cache signature when received
  if (signature && signature.length >= MIN_SIGNATURE_LENGTH) {
    const fullText = thoughtBuffer.get(candidateIndex) ?? ''
    if (fullText) {
      const cacheKey: CacheKey = {
        sessionId: sessionKey,
        model: 'claude', // Simplified - could extract from session key
        textHash: createTextHash(fullText),
      }

      signatureCache.store(cacheKey, signature, 'claude')
      lastSignedThinkingBySessionKey.set(sessionKey, {
        text: fullText,
        signature,
      })

      logger.debug(
        {
          sessionKey,
          textLength: fullText.length,
          signatureLength: signature.length,
        },
        'Cached thinking signature'
      )
    }
  }
}

// ============================================================================
// Request-side: Restore signatures to thinking blocks
// ============================================================================

/**
 * Ensure thinking blocks in the request have proper signatures.
 * Modifies the request body in place.
 */
export function ensureThinkingSignatures(
  requestBody: Record<string, unknown>,
  sessionKey: string
): void {
  const typedBody = requestBody as UnifiedRequestBody

  // Handle Gemini-style contents
  if (Array.isArray(typedBody.contents)) {
    typedBody.contents = ensureSignaturesInContents(typedBody.contents, sessionKey)
  }

  // Handle Anthropic-style messages
  if (Array.isArray(typedBody.messages)) {
    typedBody.messages = ensureSignaturesInMessages(typedBody.messages, sessionKey)
  }

  // Handle wrapped request format
  if (typedBody.request && typeof typedBody.request === 'object') {
    if (Array.isArray(typedBody.request.contents)) {
      typedBody.request.contents = ensureSignaturesInContents(
        typedBody.request.contents,
        sessionKey
      )
    }
  }
}

function ensureSignaturesInContents(contents: Content[], sessionKey: string): Content[] {
  return contents.map((content) => {
    if (!content || typeof content !== 'object' || !Array.isArray(content.parts)) {
      return content
    }

    const role = content.role
    if (role !== 'model' && role !== 'assistant') {
      return content
    }

    const parts = content.parts
    const hasToolUse = parts.some(isToolUsePart)
    if (!hasToolUse) {
      return content
    }

    // Process thinking parts
    const thinkingParts = parts
      .filter(isThinkingPart)
      .map((p) => ensurePartSignature(p, sessionKey))
    const otherParts = parts.filter((p) => !isThinkingPart(p))
    const hasSignedThinking = thinkingParts.some(hasValidSignature)

    if (hasSignedThinking) {
      return { ...content, parts: [...thinkingParts, ...otherParts] }
    }

    // Fallback: inject last signed thinking
    const lastThinking = lastSignedThinkingBySessionKey.get(sessionKey)
    if (!lastThinking) {
      return content
    }

    const injected: Part = {
      thought: true,
      text: lastThinking.text,
      thoughtSignature: lastThinking.signature,
    }

    logger.debug(
      { sessionKey, textLength: lastThinking.text.length },
      'Injected fallback thinking signature'
    )

    return { ...content, parts: [injected, ...otherParts] }
  })
}

function ensureSignaturesInMessages(messages: Message[], sessionKey: string): Message[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object' || !Array.isArray(message.content)) {
      return message
    }

    if (message.role !== 'assistant') {
      return message
    }

    const blocks = message.content as Block[]
    const hasToolUse = blocks.some((b) => b?.type === 'tool_use' || b?.type === 'tool_result')
    if (!hasToolUse) {
      return message
    }

    const thinkingBlocks = blocks
      .filter((b) => b?.type === 'thinking' || b?.type === 'redacted_thinking')
      .map((b) => ensureBlockSignature(b, sessionKey))
    const otherBlocks = blocks.filter(
      (b) => !(b?.type === 'thinking' || b?.type === 'redacted_thinking')
    )
    const hasSignedThinking = thinkingBlocks.some(
      (b) => typeof b.signature === 'string' && b.signature.length >= MIN_SIGNATURE_LENGTH
    )

    if (hasSignedThinking) {
      return { ...message, content: [...thinkingBlocks, ...otherBlocks] }
    }

    // Fallback
    const lastThinking = lastSignedThinkingBySessionKey.get(sessionKey)
    if (!lastThinking) {
      return message
    }

    const injected: Block = {
      type: 'thinking',
      thinking: lastThinking.text,
      signature: lastThinking.signature,
    }

    return { ...message, content: [injected, ...otherBlocks] }
  })
}

function isToolUsePart(part: Part): boolean {
  return !!(
    part &&
    typeof part === 'object' &&
    (part.functionCall || part.tool_use || part.toolUse)
  )
}

function isThinkingPart(part: Part): boolean {
  return !!(
    part &&
    typeof part === 'object' &&
    (part.thought === true || part.type === 'thinking' || part.type === 'reasoning')
  )
}

function hasValidSignature(part: Part | Block): boolean {
  if (!part || typeof part !== 'object') return false

  if ('thought' in part && part.thought === true) {
    return (
      typeof part.thoughtSignature === 'string' &&
      part.thoughtSignature.length >= MIN_SIGNATURE_LENGTH
    )
  }

  if (part.type === 'thinking' || part.type === 'reasoning') {
    return typeof part.signature === 'string' && part.signature.length >= MIN_SIGNATURE_LENGTH
  }

  return false
}

function ensurePartSignature(part: Part, sessionKey: string): Part {
  if (!part || typeof part !== 'object') return part

  const text =
    typeof part.text === 'string'
      ? part.text
      : typeof part.thinking === 'string'
        ? part.thinking
        : ''
  if (!text) return part

  if (part.thought === true && !part.thoughtSignature) {
    const cached = restoreSignature(sessionKey, text)
    if (cached) {
      return { ...part, thoughtSignature: cached }
    }
  }

  if ((part.type === 'thinking' || part.type === 'reasoning') && !part.signature) {
    const cached = restoreSignature(sessionKey, text)
    if (cached) {
      return { ...part, signature: cached }
    }
  }

  return part
}

function ensureBlockSignature(block: Block, sessionKey: string): Block {
  if (!block || typeof block !== 'object') return block

  if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
    return block
  }

  if (typeof block.signature === 'string' && block.signature.length >= MIN_SIGNATURE_LENGTH) {
    return block
  }

  const text =
    typeof block.thinking === 'string'
      ? block.thinking
      : typeof block.text === 'string'
        ? block.text
        : ''
  if (!text) return block

  const cached = restoreSignature(sessionKey, text)
  if (cached) {
    return { ...block, signature: cached }
  }

  return block
}

function restoreSignature(sessionKey: string, text: string): string | undefined {
  const cacheKey: CacheKey = {
    sessionId: sessionKey,
    model: 'claude',
    textHash: createTextHash(text),
  }

  return signatureCache.restore(cacheKey)
}

// Export the cache for testing
export { signatureCache }
