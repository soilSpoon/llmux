/**
 * Known provider names that can be used in model mappings
 */
export const KNOWN_PROVIDERS = [
  'openai',
  'anthropic',
  'gemini',
  'antigravity',
  'opencode-zen',
  'openai-web',
  'gemini-cli',
  'github-copilot',
] as const

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number]
