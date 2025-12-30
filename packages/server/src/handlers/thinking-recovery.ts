/**
 * Thinking Recovery Module
 *
 * Minimal implementation for recovering from corrupted thinking state.
 * When Claude's conversation history gets corrupted (thinking blocks stripped/malformed),
 * this module provides a "last resort" recovery by closing the current turn and starting fresh.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A content block part in Gemini format (parts array) or similar.
 */
interface ContentPart {
  thought?: boolean
  type?: string
  text?: string
  functionCall?: unknown
  functionResponse?: unknown
  [key: string]: unknown
}

/**
 * A content block in Anthropic format.
 */
interface ContentBlock {
  type?: string
  text?: string
  [key: string]: unknown
}

/**
 * A message in conversation history (supports both Gemini and Anthropic formats).
 */
interface ConversationMessage {
  role?: string
  parts?: ContentPart[]
  content?: ContentBlock[] | string
  [key: string]: unknown
}

/**
 * Synthetic message in Gemini format.
 */
interface GeminiMessage {
  role: 'model' | 'user'
  parts: Array<{ text: string }>
  [key: string]: unknown
}

/**
 * Synthetic message in Anthropic format.
 */
interface AnthropicMessage {
  role: 'assistant' | 'user'
  content: Array<{ type: 'text'; text: string }>
  [key: string]: unknown
}

export interface ConversationState {
  /** True if we're in an incomplete tool use loop (ends with functionResponse) */
  inToolLoop: boolean
  /** Index of first model message in current turn */
  turnStartIdx: number
  /** Whether the TURN started with thinking */
  turnHasThinking: boolean
  /** Index of last model message */
  lastModelIdx: number
  /** Whether last model msg has thinking */
  lastModelHasThinking: boolean
  /** Whether last model msg has tool calls */
  lastModelHasToolCalls: boolean
}

/**
 * Checks if a message part is a thinking/reasoning block.
 */
function isThinkingPart(part: ContentPart | ContentBlock): boolean {
  if (!part || typeof part !== 'object') return false
  return (
    ('thought' in part && part.thought === true) ||
    part.type === 'thinking' ||
    part.type === 'redacted_thinking'
  )
}

/**
 * Checks if a message part is a function response (tool result).
 */
function isFunctionResponsePart(part: ContentPart | ContentBlock): boolean {
  return (
    part !== null &&
    typeof part === 'object' &&
    ('functionResponse' in part || part.type === 'tool_result')
  )
}

/**
 * Checks if a message part is a function call.
 */
function isFunctionCallPart(part: ContentPart | ContentBlock): boolean {
  return (
    part !== null &&
    typeof part === 'object' &&
    ('functionCall' in part || part.type === 'tool_use')
  )
}

/**
 * Checks if a message is a tool result container (user role with functionResponse).
 */
function isToolResultMessage(msg: ConversationMessage): boolean {
  if (!msg || msg.role !== 'user') return false

  // Gemini format: parts array
  if (Array.isArray(msg.parts)) {
    return msg.parts.some(isFunctionResponsePart)
  }

  // Anthropic format: content array
  if (Array.isArray(msg.content)) {
    return msg.content.some(isFunctionResponsePart)
  }

  return false
}

/**
 * Checks if a message contains thinking/reasoning content.
 */
function messageHasThinking(msg: ConversationMessage): boolean {
  if (!msg || typeof msg !== 'object') return false

  // Gemini format: parts array
  if (Array.isArray(msg.parts)) {
    return msg.parts.some(isThinkingPart)
  }

  // Anthropic format: content array
  if (Array.isArray(msg.content)) {
    return msg.content.some(isThinkingPart)
  }

  return false
}

/**
 * Checks if a message contains tool calls.
 */
function messageHasToolCalls(msg: ConversationMessage): boolean {
  if (!msg || typeof msg !== 'object') return false

  // Gemini format: parts array with functionCall
  if (Array.isArray(msg.parts)) {
    return msg.parts.some(isFunctionCallPart)
  }

  // Anthropic format: content array with tool_use
  if (Array.isArray(msg.content)) {
    return msg.content.some(isFunctionCallPart)
  }

  return false
}

// ============================================================================
// CONVERSATION STATE ANALYSIS
// ============================================================================

export function analyzeConversationState(contents: ConversationMessage[]): ConversationState {
  const state: ConversationState = {
    inToolLoop: false,
    turnStartIdx: -1,
    turnHasThinking: false,
    lastModelIdx: -1,
    lastModelHasThinking: false,
    lastModelHasToolCalls: false,
  }

  if (!Array.isArray(contents) || contents.length === 0) {
    return state
  }

  // First pass: Find the last "real" user message (not a tool result)
  let lastRealUserIdx = -1
  for (let i = 0; i < contents.length; i++) {
    const msg = contents[i]
    if (msg?.role === 'user' && !isToolResultMessage(msg)) {
      lastRealUserIdx = i
    }
  }

  // Second pass: Analyze conversation and find turn boundaries
  for (let i = 0; i < contents.length; i++) {
    const msg = contents[i]
    if (!msg) continue

    const role = msg.role

    if (role === 'model' || role === 'assistant') {
      const hasThinking = messageHasThinking(msg)
      const hasToolCalls = messageHasToolCalls(msg)

      // Track if this is the turn start
      if (i > lastRealUserIdx && state.turnStartIdx === -1) {
        state.turnStartIdx = i
        state.turnHasThinking = hasThinking
      }

      state.lastModelIdx = i
      state.lastModelHasToolCalls = hasToolCalls
      state.lastModelHasThinking = hasThinking
    }
  }

  // Determine if we're in a tool loop
  // We're in a tool loop if the conversation ends with a tool result
  if (contents.length > 0) {
    const lastMsg = contents[contents.length - 1]
    if (lastMsg?.role === 'user' && isToolResultMessage(lastMsg)) {
      state.inToolLoop = true
    }
  }

  return state
}

// ============================================================================
// RECOVERY FUNCTIONS
// ============================================================================

/**
 * Strips all thinking blocks from messages.
 */
function stripAllThinkingBlocks(contents: ConversationMessage[]): ConversationMessage[] {
  return contents.map((content) => {
    if (!content || typeof content !== 'object') return content

    // Handle Gemini-style parts
    if (Array.isArray(content.parts)) {
      const filteredParts = content.parts.filter((part) => !isThinkingPart(part))
      // Keep at least one part to avoid empty messages if possible,
      // but for recovery we might want to strip completely if it was just thinking
      return { ...content, parts: filteredParts }
    }

    // Handle Anthropic-style content
    if (Array.isArray(content.content)) {
      const filteredContent = content.content.filter((block) => !isThinkingPart(block))
      return { ...content, content: filteredContent }
    }

    return content
  })
}

/**
 * Counts tool results at the end of the conversation.
 */
function countTrailingToolResults(contents: ConversationMessage[]): number {
  let count = 0

  for (let i = contents.length - 1; i >= 0; i--) {
    const msg = contents[i]

    if (msg?.role === 'user') {
      if (isToolResultMessage(msg)) {
        count++
      } else {
        break // Real user message, stop counting
      }
    } else if (msg?.role === 'model' || msg?.role === 'assistant') {
      break // Stop at the model that made the tool calls
    }
  }

  return count
}

/**
 * Closes an incomplete tool loop by injecting synthetic messages to start a new turn.
 */
export function closeToolLoopForThinking(
  contents: ConversationMessage[]
): Array<ConversationMessage | GeminiMessage | AnthropicMessage> {
  // Strip any old/corrupted thinking first
  const strippedContents = stripAllThinkingBlocks(contents)

  // Count tool results from the end of the conversation
  const toolResultCount = countTrailingToolResults(strippedContents)

  // Build synthetic model message content based on tool count
  let syntheticModelContent: string
  if (toolResultCount === 0) {
    syntheticModelContent = '[Processing previous context.]'
  } else if (toolResultCount === 1) {
    syntheticModelContent = '[Tool execution completed.]'
  } else {
    syntheticModelContent = `[${toolResultCount} tool executions completed.]`
  }

  // Helper to create message based on format (Gemini or Anthropic)
  // We infer format from the first message or default to Gemini parts
  const isAnthropicFormat = strippedContents.some((m) => Array.isArray(m.content))

  let syntheticModel: GeminiMessage | AnthropicMessage
  let syntheticUser: GeminiMessage | AnthropicMessage

  if (isAnthropicFormat) {
    syntheticModel = {
      role: 'assistant',
      content: [{ type: 'text', text: syntheticModelContent }],
    }
    syntheticUser = {
      role: 'user',
      content: [{ type: 'text', text: '[Continue]' }],
    }
  } else {
    syntheticModel = {
      role: 'model',
      parts: [{ text: syntheticModelContent }],
    }
    syntheticUser = {
      role: 'user',
      parts: [{ text: '[Continue]' }],
    }
  }

  return [...strippedContents, syntheticModel, syntheticUser]
}

/**
 * Checks if conversation state requires tool loop closure for thinking recovery.
 */
export function needsThinkingRecovery(state: ConversationState): boolean {
  return state.inToolLoop && !state.turnHasThinking
}
