/**
 * Supported provider names
 */
export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'gemini-cli'
  | 'antigravity'
  | 'opencode-zen'
  | 'openai-web'
  | 'github-copilot'
  | 'google'

const VALID_PROVIDER_NAMES: readonly ProviderName[] = [
  'openai',
  'anthropic',
  'gemini',
  'gemini-cli',
  'antigravity',
  'opencode-zen',
  'openai-web',
  'google',
] as const

export function isValidProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && VALID_PROVIDER_NAMES.includes(value as ProviderName)
}
