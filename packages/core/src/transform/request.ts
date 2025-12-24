import type { ProviderName } from '../providers/base'
import { getProvider } from '../providers/registry'

export interface TransformOptions {
  from: ProviderName
  to: ProviderName
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
  return targetProvider.transform(unified)
}
