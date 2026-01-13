export class AllCooldownError extends Error {
  provider?: string
  model?: string
  constructor(message: string, provider?: string, model?: string) {
    super(message)
    this.name = 'AllCooldownError'
    this.provider = provider
    this.model = model
  }
}

export interface UpstreamErrorInfo {
  message: string
  type?: string
  code?: string | number
  status: number
  provider?: string
  request_id?: string
  details?: unknown
}

/**
 * Recursively parse nested JSON strings in error responses.
 * Handles cases like Vertex wrapping Anthropic errors:
 * { "error": { "message": "{\"type\":\"error\",\"error\":{...}}" } }
 */
export function parseNestedJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed)
        return parseNestedJson(parsed)
      } catch {
        return value
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(parseNestedJson)
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = parseNestedJson(v)
    }
    return result
  }

  return value
}

/**
 * Extract error info from upstream error text/JSON.
 * Preserves all original information while unwrapping nested JSON.
 */
export function parseUpstreamError(errorText: string, status: number): UpstreamErrorInfo {
  const trimmed = errorText.trim()

  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    (trimmed.endsWith('}') || trimmed.endsWith(']'))
  ) {
    try {
      const parsed = parseNestedJson(JSON.parse(trimmed)) as Record<string, unknown>

      const errorObj = (parsed.error as Record<string, unknown>) || parsed

      // Handle Vertex-style wrapping where message field contains the actual error object
      const messageContent = errorObj.message
      let innerError: Record<string, unknown> | undefined
      let deepestError: Record<string, unknown> | undefined

      if (messageContent && typeof messageContent === 'object') {
        // message was a nested JSON that got parsed into an object
        const msgObj = messageContent as Record<string, unknown>
        innerError = (msgObj.error as Record<string, unknown>) || msgObj
        deepestError = innerError
      } else {
        // Standard nesting: error.error
        innerError = errorObj.error as Record<string, unknown>
        deepestError = innerError || errorObj
      }

      const effectiveError = deepestError || errorObj

      return {
        message: extractMessage(effectiveError) || extractMessage(errorObj) || errorText,
        type: (effectiveError.type as string) || (errorObj.type as string),
        code: (effectiveError.code as string | number) || (errorObj.code as string | number),
        status: typeof errorObj.status === 'number' ? errorObj.status : status,
        request_id:
          (effectiveError.request_id as string) ||
          (innerError?.request_id as string) ||
          ((messageContent as Record<string, unknown>)?.request_id as string) ||
          (parsed.request_id as string),
        details: parsed,
      }
    } catch {
      return { message: errorText, status }
    }
  }

  return { message: errorText, status }
}

function extractMessage(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.msg === 'string') return obj.msg
  return undefined
}

/**
 * Create a structured error response object for the client.
 */
export function createErrorResponse(info: UpstreamErrorInfo): { error: UpstreamErrorInfo } {
  const response: UpstreamErrorInfo = {
    message: info.message,
    status: info.status,
  }

  if (info.type) response.type = info.type
  if (info.code) response.code = info.code
  if (info.provider) response.provider = info.provider
  if (info.request_id) response.request_id = info.request_id
  if (info.details) response.details = info.details

  return { error: response }
}
