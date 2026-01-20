import type { UnifiedRequest } from '../../../types/unified.js'
import { resolveGeminiFamilyCapabilities } from '../capabilities.js'

const THINKING_HINT =
  '\n\nInterleaved thinking is enabled. You may think between tool calls to provide better results. Respond with your thoughts wrapped in <thought> tags before or between tool calls if needed.'

export function appendClaudeThinkingHint(req: UnifiedRequest): string | undefined {
  const caps = resolveGeminiFamilyCapabilities(req.model || 'unknown')

  if (
    caps.modelVendor === 'anthropic' &&
    req.thinking?.enabled &&
    req.tools &&
    req.tools.length > 0
  ) {
    const currentSystem = req.system || ''
    if (!currentSystem.includes('Interleaved thinking is enabled')) {
      return currentSystem + THINKING_HINT
    }
  }

  return req.system
}
