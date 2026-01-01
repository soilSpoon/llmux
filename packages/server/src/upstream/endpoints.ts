import type { UpstreamProvider } from './types'

export interface EndpointOptions {
  streaming?: boolean
}

const STREAMING_ENDPOINTS: Partial<Record<UpstreamProvider, string>> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  antigravity:
    'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  'opencode-zen': 'https://opencode.ai/zen/v1/messages',
  'openai-web': 'https://chatgpt.com/backend-api/codex/responses',
}

const NON_STREAMING_ENDPOINTS: Partial<Record<UpstreamProvider, string>> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
  antigravity: 'https://Daily-Cloudcode-Pa.Sandbox.Googleapis.Com/V1internal',
  'opencode-zen': 'https://opencode.ai/zen/v1/messages',
  'openai-web': 'https://chatgpt.com/backend-api/codex/responses',
}

export function getDefaultEndpoint(
  provider: UpstreamProvider | string,
  options?: EndpointOptions
): string | undefined {
  const p = provider as UpstreamProvider

  if (options?.streaming) {
    return STREAMING_ENDPOINTS[p]
  }

  return NON_STREAMING_ENDPOINTS[p] ?? STREAMING_ENDPOINTS[p]
}
