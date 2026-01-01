import type { ProviderName } from '../providers/base'
import { getProvider } from '../providers/registry'
import type { ThinkingConfig } from '../types/unified'

export interface TransformOptions {
  from: ProviderName
  to: ProviderName
  model?: string
  /**
   * Override thinking config in the UnifiedRequest before transforming.
   * Use { enabled: false } to disable thinking regardless of source request.
   */
  thinkingOverride?: ThinkingConfig
}

/**
 * Transform a request from one provider format to another
 *
 * Flow: Source Request → parse() → UnifiedRequest → transform() → Target Request
 */
export function transformRequest(request: unknown, options: TransformOptions): unknown {
  const sourceProvider = getProvider(options.from)
  const targetProvider = getProvider(options.to)

  const unified = sourceProvider.parse(request)

  // Apply thinking override if specified
  if (options.thinkingOverride !== undefined) {
    unified.thinking = options.thinkingOverride
  }

  return targetProvider.transform(unified, options.model)
}
