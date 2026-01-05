/**
 * Common response header utilities for proxy handlers
 */

const PRESERVE_UPSTREAM_HEADERS = [
  'x-request-id',
  'x-trace-id',
  'x-amp-request-id',
  'x-ratelimit-remaining',
  'x-ratelimit-limit',
  'x-ratelimit-reset',
  'x-vertex-ai-llm-request-type',
  'retry-after',
]

const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=UTF-8',
  'Cache-Control': 'no-cache, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Powered-By': 'llmux',
}

export interface ResponseHeaderOptions {
  /** Upstream response headers to preserve */
  upstreamHeaders?: Headers
  /** Additional headers to set */
  extras?: Record<string, string>
  /** Request ID to set if not present in upstream */
  requestId?: string
  /** Content-Type override */
  contentType?: string
}

/**
 * Build response headers with sensible defaults and preserved upstream headers
 */
export function buildResponseHeaders(options: ResponseHeaderOptions = {}): Headers {
  const headers = new Headers()

  // Set defaults
  for (const [key, value] of Object.entries(DEFAULT_HEADERS)) {
    headers.set(key, value)
  }

  // Override content-type if specified
  if (options.contentType) {
    headers.set('Content-Type', options.contentType)
  }

  // Preserve upstream headers
  if (options.upstreamHeaders) {
    for (const key of PRESERVE_UPSTREAM_HEADERS) {
      const value = options.upstreamHeaders.get(key)
      if (value) {
        headers.set(key, value)
      }
    }

    // Preserve vary header for caching
    const vary = options.upstreamHeaders.get('vary')
    if (vary) {
      headers.set('Vary', vary)
    }
  }

  // Set request ID if provided and not already present
  if (options.requestId && !headers.has('x-request-id') && !headers.has('x-amp-request-id')) {
    headers.set('x-request-id', options.requestId)
  }

  // Set extra headers
  if (options.extras) {
    for (const [key, value] of Object.entries(options.extras)) {
      headers.set(key, value)
    }
  }

  return headers
}

/**
 * Create a JSON response with proper headers
 */
export function createJsonResponse(
  body: unknown,
  status: number,
  options: ResponseHeaderOptions = {}
): Response {
  const headers = buildResponseHeaders(options)
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * Create an error response in a consistent format
 */
export function createErrorResponse(
  message: string,
  status: number,
  options: ResponseHeaderOptions & { type?: string; code?: string | null } = {}
): Response {
  const body = {
    error: {
      message,
      type: options.type || 'proxy_error',
      code: options.code ?? null,
    },
  }
  return createJsonResponse(body, status, options)
}
