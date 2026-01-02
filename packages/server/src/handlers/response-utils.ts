import { type ProviderName, transformResponse } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { resolveOpencodeZenProtocol } from '../providers'

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

export async function handleJsonResponse(
  response: Response,
  options: {
    currentProvider: ProviderName
    sourceFormat: RequestFormat
    model?: string
  }
): Promise<Response> {
  const { currentProvider, sourceFormat, model } = options

  // 1. If upstream returned an error (4xx/5xx), pass it through without transformation
  // This preserves the original error message and status code
  if (!response.ok) {
    // Try to parse as JSON first to preserve structure, otherwise text
    try {
      const errorBody = await response.json()
      return new Response(JSON.stringify(errorBody), {
        headers: { 'Content-Type': 'application/json' },
        status: response.status,
      })
    } catch {
      const errorText = await response.text()
      return new Response(JSON.stringify({ error: errorText || 'Upstream error' }), {
        headers: { 'Content-Type': 'application/json' },
        status: response.status,
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
    to: formatToProvider(sourceFormat),
  })

  return new Response(JSON.stringify(transformed), {
    headers: { 'Content-Type': 'application/json' },
    status: response.status,
  })
}
