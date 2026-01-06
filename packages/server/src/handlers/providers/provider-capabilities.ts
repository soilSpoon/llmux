import type { ProviderName } from '@llmux/core'

export type SseFormat = 'anthropic' | 'gemini' | 'openai'

export type StreamParser = 'sse-standard' | 'sse-line-delimited'

export interface ProviderCapabilities {
  sseFormat: SseFormat
  streamParser: StreamParser
  supportsThinking: boolean
  usesAntigravityV1Internal?: boolean
}

export const providerAliases: Record<string, ProviderName> = {
  'gemini-cli': 'antigravity',
}

export function getEffectiveProvider(provider: ProviderName): ProviderName {
  return (providerAliases[provider] as ProviderName) ?? provider
}

const THINKING_ENABLED_OPENAI_MODELS = ['o1', 'o3']

function modelSupportsThinking(model: string): boolean {
  return THINKING_ENABLED_OPENAI_MODELS.some((prefix) => model.startsWith(prefix))
}

export function getProviderCapabilities(
  provider: ProviderName,
  model?: string
): ProviderCapabilities {
  const effectiveProvider = getEffectiveProvider(provider)

  switch (effectiveProvider) {
    case 'antigravity':
      return {
        sseFormat: 'gemini',
        streamParser: 'sse-line-delimited',
        supportsThinking: true,
        usesAntigravityV1Internal: true,
      }

    case 'openai':
    case 'openai-web':
      return {
        sseFormat: 'openai',
        streamParser: 'sse-standard',
        supportsThinking: model ? modelSupportsThinking(model) : false,
      }

    case 'opencode-zen':
      if (model) {
        if (model.startsWith('gemini-')) {
          return {
            sseFormat: 'gemini',
            streamParser: 'sse-line-delimited',
            supportsThinking: true,
          }
        }
        if (model.includes('claude')) {
          return {
            sseFormat: 'anthropic',
            streamParser: 'sse-standard',
            supportsThinking: true,
          }
        }
      }
      return {
        sseFormat: 'openai',
        streamParser: 'sse-standard',
        supportsThinking: model ? modelSupportsThinking(model) : false,
      }

    default:
      return {
        sseFormat: 'anthropic',
        streamParser: 'sse-standard',
        supportsThinking: true,
      }
  }
}

export function isGeminiSseProvider(provider: ProviderName, model: string): boolean {
  return getProviderCapabilities(provider, model).sseFormat === 'gemini'
}

export function isOpenAISseProvider(provider: ProviderName, model: string): boolean {
  return getProviderCapabilities(provider, model).sseFormat === 'openai'
}

export function getParserTypeForProvider(provider: ProviderName, model?: string): StreamParser {
  return getProviderCapabilities(provider, model).streamParser
}
