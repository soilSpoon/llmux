/**
 * Signature Integration for Multi-turn Claude Thinking Conversations
 *
 * This module integrates SignatureCache with streaming handlers to:
 * 1. Cache thoughtSignatures from streaming responses
 * 2. Restore signatures to thinking blocks in subsequent requests
 */

import crypto from 'node:crypto'
import {
  type CacheKey,
  createLogger,
  createTextHash,
  getModelFamily,
  SignatureCache,
  SQLiteStorage,
} from '@llmux/core'
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
} from './thinking-recovery'

const logger = createLogger({ service: 'signature-integration' })

// Singleton cache instance for the server
// Uses persistent SQLite storage in ~/.llmux/signatures.db
const signatureCache = new SignatureCache({
  ttl: 60 * 60 * 1000, // 1 hour memory TTL
  maxEntriesPerSession: 100,
  storage: new SQLiteStorage(), // Layer 3: Persistent Storage
})

// Fallback: Last signed thinking per session key (for tool use cases)
const lastSignedThinkingBySessionKey = new Map<
  string,
  { text: string; signature: string; contextHash?: string }
>()

// ============================================================================
// LAYER 2: Global Signature Store (Antigravity method)
// ============================================================================
// Captures valid thoughtSignatures indexed by contextHash.
// Used as fallback when session-specific cache misses.
interface GlobalSignatureEntry {
  text: string
  signature: string
  model: string | null
  timestamp: number
}

const MAX_GLOBAL_ENTRIES = 50
const MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes

// Map from contextHash to signature entry
const globalThoughtSignatureStore = new Map<string, GlobalSignatureEntry>()

/**
 * Store a signature in the global store indexed by contextHash.
 * Used to capture signatures from streaming responses.
 * @param contextHash - Hash of the conversation context (messages before this response)
 */
export function storeGlobalThoughtSignature(
  signature: string,
  text: string,
  model?: string,
  contextHash?: string
): void {
  if (!signature || signature.length < MIN_SIGNATURE_LENGTH || !text || !contextHash) {
    return
  }

  // Cleanup expired entries periodically
  const now = Date.now()
  for (const [hash, entry] of globalThoughtSignatureStore) {
    if (now - entry.timestamp > MAX_AGE_MS) {
      globalThoughtSignatureStore.delete(hash)
    }
  }

  // Enforce max entries (remove oldest if needed)
  if (globalThoughtSignatureStore.size >= MAX_GLOBAL_ENTRIES) {
    let oldestHash: string | null = null
    let oldestTimestamp = Infinity
    for (const [hash, entry] of globalThoughtSignatureStore) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
        oldestHash = hash
      }
    }
    if (oldestHash) {
      globalThoughtSignatureStore.delete(oldestHash)
    }
  }

  globalThoughtSignatureStore.set(contextHash, {
    text,
    signature,
    model: model || null,
    timestamp: now,
  })

  logger.debug(
    {
      signatureLength: signature.length,
      textLength: text.length,
      contextHash: contextHash.slice(0, 8),
      storeSize: globalThoughtSignatureStore.size,
    },
    'Stored signature in global store (Layer 2 fallback)'
  )
}

/**
 * Get the global thought signature for a specific context.
 * Returns undefined if signature is older than 10 minutes or context hash not found.
 * @param targetModel - The target model to check for family compatibility
 * @param currentContextHash - Hash of the current conversation context to lookup
 */
export function getGlobalThoughtSignature(
  targetModel?: string,
  currentContextHash?: string
): { text: string; signature: string } | undefined {
  if (!currentContextHash) return undefined

  const entry = globalThoughtSignatureStore.get(currentContextHash)
  if (!entry) return undefined

  const { signature, text, model, timestamp } = entry

  // Prevent cross-model pollution (e.g. injecting Claude signature into Gemini)
  if (targetModel && model && getModelFamily(targetModel) !== getModelFamily(model)) {
    logger.debug(
      { storedModel: model, targetModel },
      'Skipping global signature: model family mismatch'
    )
    return undefined
  }

  const age = Date.now() - timestamp
  if (age > MAX_AGE_MS) {
    globalThoughtSignatureStore.delete(currentContextHash)
    logger.debug(
      { ageSeconds: Math.floor(age / 1000) },
      'Global signature expired (Layer 2 fallback timeout)'
    )
    return undefined
  }

  return { text, signature }
}

/**
 * Clear the global signature store.
 */
export function clearGlobalThoughtSignature(): void {
  globalThoughtSignatureStore.clear()
  logger.debug({}, 'Cleared global signature store')
}

const MIN_SIGNATURE_LENGTH = 50

/**
 * Create a hash of the conversation context (all messages except the last assistant message).
 * This hash is used to validate that a cached signature belongs to the same conversation.
 */
export function createConversationContextHash(contents?: Content[], messages?: Message[]): string {
  const parts: string[] = []

  if (contents && Array.isArray(contents)) {
    for (const content of contents) {
      if (!content || typeof content !== 'object') continue
      const role = content.role || 'unknown'
      const textParts: string[] = []

      if (Array.isArray(content.parts)) {
        for (const part of content.parts) {
          if (part && typeof part.text === 'string') {
            textParts.push(part.text.slice(0, 100))
          }
        }
      }

      parts.push(`${role}:${textParts.join('|')}`)
    }
  }

  if (messages && Array.isArray(messages)) {
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const role = message.role || 'unknown'
      let textContent = ''

      if (typeof message.content === 'string') {
        textContent = message.content.slice(0, 100)
      } else if (Array.isArray(message.content)) {
        const texts = message.content
          .filter((b): b is Block => b?.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text?.slice(0, 100) || '')
        textContent = texts.join('|')
      }

      parts.push(`${role}:${textContent}`)
    }
  }

  const contextString = parts.join('\n')
  return createTextHash(contextString)
}

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
// Response-side: Cache signatures from streaming responses
// ============================================================================

/**
 * Process a streaming chunk and cache any thoughtSignatures found.
 * Call this for each transformed chunk in the streaming handler.
 * @param contextHash - Hash of the conversation context at request time
 */
export function cacheSignatureFromChunk(
  sessionKey: string,
  chunkData: {
    thinking?: { text?: string; signature?: string }
  },
  thoughtBuffer: Map<number, string>,
  candidateIndex = 0,
  contextHash?: string
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
      // Extract model from sessionKey if possible, or default to checking via helper
      // sessionKey format involved: SERVER_SESSION_ID:modelKey:projectPart:conversationPart
      // But we can just use getModelFamily on the modelKey part if we parse it,
      // OR better: since we are in a context where we know it's NOT OpenAI (checked by caller),
      // we can try to detect family or fallback to 'claude' as a safe default for storage.
      // However, correct storage family is important for some logic?
      // Actually SignatureCache.store takes family but mostly for metadata.

      let family: 'claude' | 'gemini' | 'openai' = 'claude'
      const parts = sessionKey.split(':')
      if (parts.length >= 2) {
        const modelKey = parts[1]
        if (modelKey) {
          family = getModelFamily(modelKey)
        }
      }

      const cacheKey: CacheKey = {
        sessionId: sessionKey,
        model: family,
        textHash: createTextHash(fullText),
      }

      signatureCache.store(cacheKey, signature, family)
      lastSignedThinkingBySessionKey.set(sessionKey, {
        text: fullText,
        signature,
        contextHash,
      })

      // 🔧 LAYER 2: Store in global signature store (Antigravity method)
      // This is used as fallback when session-specific cache misses on subsequent requests
      // Now includes contextHash for cross-conversation validation
      storeGlobalThoughtSignature(signature, fullText, family, contextHash)

      logger.debug(
        {
          sessionKey,
          textLength: fullText.length,
          signatureLength: signature.length,
        },
        'Cached thinking signature (Layer 1 session + Layer 2 global)'
      )
    }
  }
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

  // Only process Claude thinking models
  if (!model || !shouldCacheSignatures(model)) {
    return
  }

  // STEP 1: Strip ALL thinking blocks to prevent corruption
  // (Deep recursive filter to handle nested structures)
  if (Array.isArray(typedBody.contents)) {
    typedBody.contents = stripAllThinkingFromContents(typedBody.contents, sessionKey)
  }
  if (Array.isArray(typedBody.messages)) {
    typedBody.messages = stripAllThinkingFromMessages(typedBody.messages, sessionKey)
  }

  // Handle wrapped request format
  if (typedBody.request && typeof typedBody.request === 'object') {
    if (Array.isArray(typedBody.request.contents)) {
      typedBody.request.contents = stripAllThinkingFromContents(
        typedBody.request.contents,
        sessionKey
      )
    }
    if (Array.isArray(typedBody.request.messages)) {
      typedBody.request.messages = stripAllThinkingFromMessages(
        typedBody.request.messages,
        sessionKey
      )
    }
  }

  // --------------------------------------------------------------------------
  // Check Model Family:
  // - Gemini: STRIP ONLY. Do not inject signatures. (Avoids "Corrupted thought signature" errors)
  // - Claude: STRIP & RESTORE. Needs signatures for Extended Thinking.
  // --------------------------------------------------------------------------
  const family = getModelFamily(model || 'claude') // Default to claude if unknown but passed guard
  if (family === 'openai') {
    logger.debug({ model }, 'Skipping signature restoration for OpenAI')
    return
  }
  // Note: Removed the block for Gemini. We WANT to restore signatures for Gemini
  // if they involve tool use, provided we have the correct signature/text.

  // Generate context hash for signature validation
  const contextHash = createConversationContextHash(typedBody.contents, typedBody.messages)

  // STEP 2: Inject cached thinking only for tool-use cases
  // (Only inject before tool_use blocks to prevent invalid signatures)
  if (Array.isArray(typedBody.contents)) {
    typedBody.contents = ensureSignaturesInContents(typedBody.contents, sessionKey, contextHash)
  }
  if (Array.isArray(typedBody.messages)) {
    typedBody.messages = ensureSignaturesInMessages(typedBody.messages, sessionKey, contextHash)
  }

  // Handle wrapped request format (step 2)
  if (typedBody.request && typeof typedBody.request === 'object') {
    const nestedRequest = typedBody.request as Record<string, unknown>
    // Generate context hash for nested request
    const nestedContextHash = createConversationContextHash(
      nestedRequest.contents as Message[] | undefined,
      nestedRequest.messages as Message[] | undefined
    )
    if (Array.isArray(nestedRequest.contents)) {
      nestedRequest.contents = ensureSignaturesInContents(
        nestedRequest.contents,
        sessionKey,
        nestedContextHash
      )
    }
    if (Array.isArray(nestedRequest.messages)) {
      nestedRequest.messages = ensureSignaturesInMessages(
        nestedRequest.messages,
        sessionKey,
        nestedContextHash
      )
    }
  }

  // ============================================================================
  // STEP 3: Apply Layer 3/4 recovery if needed
  // Last resort: separate turn if we're in tool loop without thinking
  // ============================================================================

  // Helper to check if a content array has thinking blocks (Layer 2 success indicator)
  const hasThinkingBlocks = (items: Array<Content | Message>): boolean => {
    return items.some((item) => {
      // Check Gemini parts
      if ('parts' in item && Array.isArray(item.parts)) {
        return item.parts.some(isThinkingPart)
      }
      // Check Anthropic blocks
      if ('content' in item && Array.isArray(item.content)) {
        return item.content.some((block): block is Block => isThinkingPart(block as Part))
      }
      return false
    })
  }

  // Apply Layer 3 recovery if no thinking present in tool loop
  if (Array.isArray(typedBody.contents)) {
    const state = analyzeConversationState(typedBody.contents)
    if (needsThinkingRecovery(state) && !hasThinkingBlocks(typedBody.contents)) {
      typedBody.contents = closeToolLoopForThinking(typedBody.contents)
      logger.info(
        { sessionKey },
        'Applied Layer 4 recovery: separated tool loop for thinking generation'
      )
    }
  }

  if (Array.isArray(typedBody.messages)) {
    const state = analyzeConversationState(typedBody.messages)
    if (needsThinkingRecovery(state) && !hasThinkingBlocks(typedBody.messages)) {
      typedBody.messages = closeToolLoopForThinking(typedBody.messages)
      logger.info(
        { sessionKey },
        'Applied Layer 4 recovery: separated tool loop for thinking generation (messages)'
      )
    }
  }

  if (typedBody.request && typeof typedBody.request === 'object') {
    const req = typedBody.request as UnifiedRequestBody
    if (Array.isArray(req.contents)) {
      const state = analyzeConversationState(req.contents)
      if (needsThinkingRecovery(state) && !hasThinkingBlocks(req.contents)) {
        req.contents = closeToolLoopForThinking(req.contents)
        logger.info(
          { sessionKey },
          'Applied Layer 4 recovery: separated tool loop for thinking generation (wrapped request)'
        )
      }
    }
    if (Array.isArray(req.messages)) {
      const state = analyzeConversationState(req.messages)
      if (needsThinkingRecovery(state) && !hasThinkingBlocks(req.messages)) {
        req.messages = closeToolLoopForThinking(req.messages)
        logger.info(
          { sessionKey },
          'Applied Layer 4 recovery: separated tool loop for thinking generation (wrapped messages)'
        )
      }
    }
  }
}

/**
 * STEP 1: Strip all thinking blocks from contents array.
 * Recursively removes thinking/reasoning parts to prevent corruption.
 */
function stripAllThinkingFromContents(contents: Content[], _sessionKey: string): Content[] {
  return contents.map((content) => {
    if (!content || typeof content !== 'object') {
      return content
    }

    if (!Array.isArray(content.parts)) {
      return content
    }

    // Filter out all thinking parts
    const nonThinkingParts = content.parts.filter((part) => {
      if (!part || typeof part !== 'object') {
        return true
      }
      const p = part as Part
      // Remove if it's a thinking part
      if (p.thought === true || p.type === 'thinking' || p.type === 'reasoning') {
        return false
      }
      return true
    })

    return { ...content, parts: nonThinkingParts }
  })
}

/**
 * STEP 1: Strip all thinking blocks from messages array.
 * Recursively removes thinking/reasoning blocks to prevent corruption.
 */
function stripAllThinkingFromMessages(messages: Message[], _sessionKey: string): Message[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message
    }

    if (!Array.isArray(message.content)) {
      return message
    }

    // Filter out all thinking blocks
    const nonThinkingContent = (message.content as Block[]).filter((block) => {
      if (!block || typeof block !== 'object') {
        return true
      }
      const b = block as Block
      // Remove if it's a thinking block
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        return false
      }
      return true
    })

    return { ...message, content: nonThinkingContent }
  })
}

function ensureSignaturesInContents(
  contents: Content[],
  sessionKey: string,
  contextHash?: string
): Content[] {
  // Find the last model/assistant message index
  const lastModelIndex = findLastIndex(
    contents,
    (c: Content) => c?.role === 'model' || c?.role === 'assistant'
  )

  return contents.map((content, index) => {
    if (!content || typeof content !== 'object' || !Array.isArray(content.parts)) {
      return content
    }

    const role = content.role
    if (role !== 'model' && role !== 'assistant') {
      return content
    }

    const parts = content.parts
    const hasToolUse = parts.some(isToolUsePart)
    const isLastModelMessage = index === lastModelIndex

    // Process if tool_use is present OR if this is the last model message
    // Claude API requires: thinking before tool_use AND final assistant must start with thinking
    if (!hasToolUse && !isLastModelMessage) {
      return content
    }

    // Process existing thinking parts (restore signatures if cached)
    const thinkingParts = parts
      .filter(isThinkingPart)
      .map((p) => ensurePartSignature(p, sessionKey))
    const otherParts = parts.filter((p) => !isThinkingPart(p))
    const hasSignedThinking = thinkingParts.some(hasValidSignature)

    // If existing thinking has valid signatures, use them
    if (hasSignedThinking) {
      return { ...content, parts: [...thinkingParts, ...otherParts] }
    }

    // STEP 2: Inject cached thinking for tool-use case
    // After Step 1 (stripping), re-inject cached thinking if available.
    // This is necessary because Claude API requires thinking before tool_use blocks.
    // Since we stripped all thinking in Step 1, we need to re-inject the last signed thinking.

    // 🔧 LAYER 1: Try session-specific cache first (highest priority)
    const lastThinking = lastSignedThinkingBySessionKey.get(sessionKey)
    // Only use if context hash matches (if provided)
    if (
      lastThinking &&
      (!contextHash || !lastThinking.contextHash || lastThinking.contextHash === contextHash)
    ) {
      const injected: Part = {
        thought: true,
        text: lastThinking.text,
        thoughtSignature: lastThinking.signature,
      }

      return { ...content, parts: [injected, ...otherParts] }
    }

    // 🔧 LAYER 2: Try global signature store (Antigravity fallback)
    // Uses the most recent valid signature from any session
    // Must apply to BOTH tool_use cases AND the last model message
    // (Claude API requires: thinking before tool_use AND final assistant must start with thinking)
    // Now includes contextHash validation to prevent cross-conversation pollution
    const globalData = getGlobalThoughtSignature(sessionKey.split(':')[1], contextHash)
    if (globalData && (hasToolUse || isLastModelMessage)) {
      const injected: Part = {
        thought: true,
        text: globalData.text, // Use ACTUAL text, not placeholder
        thoughtSignature: globalData.signature,
      }

      return { ...content, parts: [injected, ...otherParts] }
    }

    // No cached thinking available - return content as-is
    // Claude will generate fresh thinking when needed
    return content
  })
}

function ensureSignaturesInMessages(
  messages: Message[],
  sessionKey: string,
  contextHash?: string
): Message[] {
  // Find the last assistant message index
  const lastAssistantIndex = findLastIndex(messages, (m: Message) => m?.role === 'assistant')

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object' || !Array.isArray(message.content)) {
      return message
    }

    if (message.role !== 'assistant') {
      return message
    }

    const blocks = message.content as Block[]
    const hasToolUse = blocks.some((b) => b?.type === 'tool_use' || b?.type === 'tool_result')
    const isLastAssistantMessage = index === lastAssistantIndex

    // Process if tool_use is present OR if this is the last assistant message
    // Claude API requires: thinking before tool_use AND final assistant must start with thinking
    if (!hasToolUse && !isLastAssistantMessage) {
      return message
    }

    // Process existing thinking blocks (restore signatures if cached)
    const thinkingBlocks = blocks
      .filter((b) => b?.type === 'thinking' || b?.type === 'redacted_thinking')
      .map((b) => ensureBlockSignature(b, sessionKey))
    const otherBlocks = blocks.filter(
      (b) => !(b?.type === 'thinking' || b?.type === 'redacted_thinking')
    )
    const hasSignedThinking = thinkingBlocks.some(
      (b) => typeof b.signature === 'string' && b.signature.length >= MIN_SIGNATURE_LENGTH
    )

    // If existing thinking has valid signatures, use them
    if (hasSignedThinking) {
      return { ...message, content: [...thinkingBlocks, ...otherBlocks] }
    }

    // STEP 2: Inject cached thinking for tool-use case
    // After Step 1 (stripping), re-inject cached thinking if available.
    // This is necessary because Claude API requires thinking before tool_use blocks.

    // 🔧 LAYER 1: Try session-specific cache first (highest priority)
    const lastThinking = lastSignedThinkingBySessionKey.get(sessionKey)
    if (lastThinking) {
      const injected: Block = {
        type: 'thinking',
        thinking: lastThinking.text,
        signature: lastThinking.signature,
      }

      return { ...message, content: [injected, ...otherBlocks] }
    }

    // 🔧 LAYER 2: Try global signature store (Antigravity fallback)
    // Uses the most recent valid signature from any session
    // Now includes contextHash validation to prevent cross-conversation pollution
    const globalData = getGlobalThoughtSignature(sessionKey.split(':')[1], contextHash)
    if (globalData && hasToolUse) {
      const injected: Block = {
        type: 'thinking',
        thinking: globalData.text, // Use ACTUAL text, not placeholder
        signature: globalData.signature,
      }

      return { ...message, content: [injected, ...otherBlocks] }
    }

    // No cached thinking available - return message as-is
    // Claude will generate fresh thinking when needed
    return message
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
  // Attempt to derive family from sessionKey to be consistent, though restore mainly uses sessionId+textHash
  let family = 'claude'
  const parts = sessionKey.split(':')
  if (parts.length >= 2) {
    family = getModelFamily(parts[1] || 'claude')
  }

  const cacheKey: CacheKey = {
    sessionId: sessionKey,
    model: family,
    textHash: createTextHash(text),
  }

  return signatureCache.restore(cacheKey)
}

// Export the cache for testing
export { signatureCache }

/**
 * Polyfill-like helper for findLastIndex
 */
function findLastIndex<T>(array: T[], predicate: (item: T, index: number) => boolean): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i] as T, i)) {
      return i
    }
  }
  return -1
}
