import type { UpstreamProvider } from './types'

export interface EndpointOptions {
  streaming?: boolean
  model?: string
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const STREAMING_ENDPOINTS: Partial<Record<UpstreamProvider, string>> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: GEMINI_API_BASE,
  antigravity:
    'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  'gemini-cli': 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  'opencode-zen': 'https://opencode.ai/zen/v1/messages',
  'openai-web': 'https://chatgpt.com/backend-api/codex/responses',
}

const NON_STREAMING_ENDPOINTS: Partial<Record<UpstreamProvider, string>> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: GEMINI_API_BASE,
  antigravity: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
  'gemini-cli': 'https://cloudcode-pa.googleapis.com/v1internal:generateContent',
  'opencode-zen': 'https://opencode.ai/zen/v1/messages',
  'openai-web': 'https://chatgpt.com/backend-api/codex/responses',
}

export function getDefaultEndpoint(
  provider: UpstreamProvider | string,
  options?: EndpointOptions
): string | undefined {
  const p = provider as UpstreamProvider

  // Gemini requires dynamic URL construction with model name and action
  if (p === 'gemini') {
    const model = options?.model || 'gemini-pro'
    if (options?.streaming) {
      return `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse`
    }
    return `${GEMINI_API_BASE}/${model}:generateContent`
  }

  if (options?.streaming) {
    return STREAMING_ENDPOINTS[p]
  }

  return NON_STREAMING_ENDPOINTS[p] ?? STREAMING_ENDPOINTS[p]
}
