import type { ProviderName } from '@llmux/core/providers/base'
import type { UnifiedMessage, UnifiedRequest } from '@llmux/core/types/unified'

/**
 * Apply prompt caching to a UnifiedRequest.
 * Automatically selects the best messages to cache based on provider heuristics.
 *
 * Strategy:
 * - Anthropic: Cache system prompt + last large user message or tool results
 * - OpenAI (compatible): Use promptCacheKey in user/metadata or cache_control
 *
 * @param request The request to modify
 * @param provider The target provider
 */
export function applyPromptCaching(request: UnifiedRequest, provider: ProviderName): void {
  // Only apply if explicitly requested or configured defaults
  // For now, we assume this is called if caching is desired.

  if (provider === 'anthropic' || provider === 'antigravity') {
    applyAnthropicCaching(request)
  } else if (provider === 'openai' || provider === 'opencode-zen') {
    applyOpenAICaching(request)
  }
}

/**
 * Apply caching for Anthropic (beta header style)
 * Anthropic allows up to 4 cache breakpoints.
 * We prioritize:
 * 1. System prompt (if large enough)
 * 2. Large context blocks (e.g. docs)
 * 3. Recent turn boundary
 */
function applyAnthropicCaching(request: UnifiedRequest): void {
  let breakpoints = 0
  const MAX_BREAKPOINTS = 4 // Anthropic limits to 4 cache breakpoints per request

  // 1. Cache System Prompt
  if (request.systemBlocks && request.systemBlocks.length > 0) {
    // Cache the last system block
    const lastSystem = request.systemBlocks[request.systemBlocks.length - 1]
    if (lastSystem && !lastSystem.cacheControl) {
      lastSystem.cacheControl = { type: 'ephemeral' }
      breakpoints++
    }
  }

  // 2. Cache User Messages
  // Working backwards, cache the last 2 user messages (common pattern for multi-turn)
  // or cache tool results if they are large.

  // Strategy from OpenCode: Cache first 2 system, and last 2 non-system messages
  // We'll adapt to cache strategic points.

  const messages = request.messages
  if (messages.length === 0) return

  // Identify potential cache points
  // We want to cache the prefix of the conversation that is reused.

  // Cache the second-to-last user message (the stable context before the current turn)
  // Or cache large tool results.

  for (let i = messages.length - 2; i >= 0 && breakpoints < MAX_BREAKPOINTS; i--) {
    const msg = messages[i]
    if (!msg) continue

    // Skip if already cached
    if (hasCacheControl(msg)) {
      breakpoints++
      continue
    }

    // Heuristic: Cache large tool results or long user messages
    if (msg.role === 'user' || msg.role === 'tool') {
      // Apply cache to the last part of the message
      const lastPart = msg.parts[msg.parts.length - 1]
      if (lastPart) {
        lastPart.cacheControl = { type: 'ephemeral' }
        breakpoints++
      }
    }
  }
}

function hasCacheControl(msg: UnifiedMessage): boolean {
  return msg.parts.some((p) => !!p.cacheControl)
}

/**
 * Apply caching for OpenAI-compatible providers (using promptCacheKey or similar extensions)
 */
function applyOpenAICaching(request: UnifiedRequest): void {
  // If we have a promptCacheKey in metadata, ensure it's propagated
  // This logic is mostly handled in the provider transform (core),
  // but here we can set it if missing based on session ID.

  if (!request.metadata) request.metadata = {}

  // If no specific cache key, use sessionId as a default for session-based caching
  if (!request.metadata.promptCacheKey && request.metadata.sessionId) {
    request.metadata.promptCacheKey = request.metadata.sessionId
  }
}
