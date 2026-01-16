/**
 * Model Capabilities
 *
 * Table-driven detection of model capabilities, replacing scattered
 * string matching heuristics throughout the codebase.
 */

/**
 * Provider identifiers
 */
export type ProviderType = 'antigravity' | 'anthropic' | 'openai' | 'gemini' | 'unknown'

/**
 * Model capability detection rules
 * Each rule has a pattern (regex or predicate) and the provider it applies to.
 * Rules are evaluated in order; first match wins.
 */
interface ModelCapabilityRule {
  /** Pattern to match against model name (case-insensitive) */
  pattern: RegExp
  /** Whether this model supports thinking features */
  supportsThinking: boolean
  /** Optional: restrict to specific provider(s). If undefined, applies to all. */
  providers?: ProviderType[]
}

/**
 * Capability rules table
 *
 * Models are matched against these rules in order.
 * First matching rule determines capabilities.
 */
const THINKING_CAPABILITY_RULES: ModelCapabilityRule[] = [
  // Claude thinking models (explicit "thinking" in name)
  // e.g., claude-3-7-sonnet-thinking, claude-sonnet-4-5-thinking-low
  {
    pattern: /claude.*thinking/i,
    supportsThinking: true,
  },

  // Gemini 3 models have native thinking support
  // e.g., gemini-3-pro, gemini-3-flash, gemini-3-pro-high
  {
    pattern: /gemini-3/i,
    supportsThinking: true,
  },

  // Gemini 2.5 models have thinking support
  // e.g., gemini-2.5-flash, gemini-2.5-pro
  {
    pattern: /gemini-2\.5/i,
    supportsThinking: true,
  },

  // OpenAI models with explicit o1/o3 prefix (reasoning models)
  // e.g., o1-preview, o1-mini, o3, o3-mini
  {
    pattern: /^o[13](-|$)/i,
    supportsThinking: true,
    providers: ['openai'],
  },

  // Default: no thinking support
  {
    pattern: /.*/,
    supportsThinking: false,
  },
]

/**
 * Normalizes a provider string to a known provider type
 */
function normalizeProvider(provider: string | undefined): ProviderType {
  if (!provider) return 'unknown'

  const lower = provider.toLowerCase()

  if (lower === 'antigravity' || lower.includes('antigravity')) return 'antigravity'
  if (lower === 'anthropic' || lower.includes('anthropic')) return 'anthropic'
  if (lower === 'openai' || lower.includes('openai')) return 'openai'
  if (lower === 'gemini' || lower === 'google' || lower.includes('gemini')) return 'gemini'

  return 'unknown'
}

/**
 * Determines if a model supports thinking/reasoning features
 *
 * This replaces scattered `model.includes('thinking')` checks with
 * a centralized, table-driven approach.
 *
 * @param model - The model identifier (e.g., "claude-3-7-sonnet-thinking")
 * @param provider - Optional provider identifier (e.g., "antigravity")
 * @returns true if the model supports thinking features
 *
 * @example
 * isThinkingModel('claude-3-7-sonnet-thinking') // true
 * isThinkingModel('gemini-3-pro') // true
 * isThinkingModel('gpt-4o') // false
 */
export function isThinkingModel(model: string, provider?: string): boolean {
  const normalizedProvider = normalizeProvider(provider)

  for (const rule of THINKING_CAPABILITY_RULES) {
    // Check if pattern matches
    if (!rule.pattern.test(model)) {
      continue
    }

    // Check if provider restriction applies
    if (rule.providers && !rule.providers.includes(normalizedProvider)) {
      continue
    }

    return rule.supportsThinking
  }

  // Should never reach here due to catch-all rule, but default to false
  return false
}
