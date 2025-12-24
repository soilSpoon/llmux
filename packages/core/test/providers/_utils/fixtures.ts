import type {
  ContentPart,
  JSONSchema,
  ToolCall,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedTool,
} from '../../../src/types/unified'

/**
 * Creates a unified message with text content
 */
export function createUnifiedMessage(
  role: UnifiedMessage['role'],
  text: string
): UnifiedMessage {
  return {
    role,
    parts: [{ type: 'text', text }],
  }
}

/**
 * Creates a tool call object
 */
export function createUnifiedToolCall(
  name: string,
  args: Record<string, unknown> = {},
  id = `call_${Math.random().toString(36).slice(2, 11)}`
): ToolCall {
  return {
    id,
    name,
    arguments: args,
  }
}

/**
 * Creates a unified tool definition
 */
export function createUnifiedTool(
  name: string,
  description?: string,
  parameters: JSONSchema = { type: 'object', properties: {} }
): UnifiedTool {
  return {
    name,
    description,
    parameters,
  }
}

/**
 * Creates a unified request with default values
 */
export function createUnifiedRequest(
  overrides: Partial<UnifiedRequest> = {}
): UnifiedRequest {
  return {
    messages: [createUnifiedMessage('user', 'Hello')],
    config: {
      temperature: 0.7,
      maxTokens: 1000,
    },
    ...overrides,
  }
}

/**
 * Creates a unified response with default values
 */
export function createUnifiedResponse(
  overrides: Partial<UnifiedResponse> = {}
): UnifiedResponse {
  return {
    id: `resp_${Math.random().toString(36).slice(2, 11)}`,
    content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
    stopReason: 'end_turn',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    model: 'test-model',
    ...overrides,
  }
}
