/**
 * Session Recovery Handler
 *
 * Handles recoverable errors in LLM sessions:
 * - tool_result_missing: When tool execution is interrupted (e.g., ESC pressed)
 * - thinking_block_order: When thinking blocks are corrupted/stripped
 * - thinking_disabled_violation: When thinking appears in non-thinking model
 */

export type RecoverableErrorType =
  | 'tool_result_missing'
  | 'thinking_block_order'
  | 'thinking_disabled_violation'

export interface SyntheticToolResult {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

/**
 * Extract a normalized error message from an unknown error.
 */
function getErrorMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [
    errorObj.data,
    errorObj.error,
    errorObj,
    (errorObj.data as Record<string, unknown> | undefined)?.error,
  ]

  for (const obj of paths) {
    if (obj && typeof obj === 'object') {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === 'string' && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Detect the type of recoverable error from an error object.
 */
export function detectRecoverableError(error: unknown): RecoverableErrorType | null {
  const message = getErrorMessage(error)

  // tool_result_missing: Happens when ESC is pressed during tool execution
  if (message.includes('tool_use') && message.includes('tool_result')) {
    return 'tool_result_missing'
  }

  // thinking_block_order: Happens when thinking blocks are corrupted
  if (
    message.includes('thinking') &&
    (message.includes('first block') ||
      message.includes('must start with') ||
      message.includes('preceeding') ||
      (message.includes('expected') && message.includes('found')))
  ) {
    return 'thinking_block_order'
  }

  // thinking_disabled_violation: Thinking in non-thinking model
  if (message.includes('thinking is disabled') && message.includes('cannot contain')) {
    return 'thinking_disabled_violation'
  }

  return null
}

/**
 * Check if an error is recoverable.
 */
export function isRecoverableError(error: unknown): boolean {
  return detectRecoverableError(error) !== null
}

/**
 * Create synthetic tool_result blocks for missing tool responses.
 * Used when tool execution is interrupted (e.g., network error, ESC pressed).
 */
export function injectSyntheticToolResult(toolUseIds: string[]): SyntheticToolResult[] {
  if (toolUseIds.length === 0) {
    return []
  }

  return toolUseIds.map((id) => ({
    type: 'tool_result' as const,
    tool_use_id: id,
    content: 'Operation cancelled by user or system interruption',
  }))
}

/**
 * Extract tool_use IDs from message parts.
 */
export function extractToolUseIds(parts: unknown[]): string[] {
  return parts
    .filter((part): part is { type: 'tool_use'; id: string } => {
      if (!part || typeof part !== 'object') return false
      const p = part as Record<string, unknown>
      return p.type === 'tool_use' && typeof p.id === 'string'
    })
    .map((p) => p.id)
}
