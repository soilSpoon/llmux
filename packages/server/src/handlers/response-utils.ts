import { formatIdToProviderName, type ProviderName, transformResponse } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { resolveOpencodeZenProtocol } from '../providers'
import { createErrorResponse, createJsonResponse } from './response-headers'

export async function handleJsonResponse(
  response: Response,
  options: {
    currentProvider: ProviderName
    sourceFormat: RequestFormat
    model?: string
    requestId?: string
  }
): Promise<Response> {
  const { currentProvider, sourceFormat, model, requestId } = options

  // 1. If upstream returned an error (4xx/5xx), pass it through without transformation
  // This preserves the original error message and status code
  if (!response.ok) {
    // Try to parse as JSON first to preserve structure, otherwise text
    try {
      const errorBody = await response.json()
      return createJsonResponse(errorBody, response.status, {
        upstreamHeaders: response.headers,
        requestId,
      })
    } catch {
      const errorText = await response.text()
      return createErrorResponse(errorText || 'Upstream error', response.status, {
        upstreamHeaders: response.headers,
        requestId,
        type: 'upstream_error',
      })
    }
  }

  // 2. Success path
  const upstreamBody = await response.json()

  let fromProvider = currentProvider
  if (currentProvider === 'opencode-zen' && model) {
    const protocol = resolveOpencodeZenProtocol(model)
    if (protocol) {
      fromProvider = protocol as ProviderName
    }
  }

  const transformed = transformResponse(upstreamBody, {
    from: fromProvider,
    to: formatIdToProviderName(sourceFormat),
    model,
  })

  return createJsonResponse(transformed, response.status, {
    upstreamHeaders: response.headers,
    requestId,
  })
}
