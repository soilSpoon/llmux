import { ANTIGRAVITY_HEADERS } from '@llmux/auth'
import type { UpstreamProvider } from './types'

export interface BuildHeadersOptions {
  fromProtocol?: string
}

export function buildUpstreamHeaders(
  targetProvider: UpstreamProvider | string,
  apiKey?: string,
  options?: BuildHeadersOptions
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (!apiKey) return headers

  switch (targetProvider) {
    case 'anthropic':
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      break
    case 'openai':
    case 'openai-web':
      headers.Authorization = `Bearer ${apiKey}`
      break
    case 'gemini':
      headers['x-goog-api-key'] = apiKey
      break
    case 'antigravity':
      headers.Authorization = `Bearer ${apiKey}`
      Object.assign(headers, ANTIGRAVITY_HEADERS)
      break
    case 'opencode-zen':
      if (options?.fromProtocol === 'openai') {
        headers.Authorization = `Bearer ${apiKey}`
      } else {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      }
      break
  }

  return headers
}
