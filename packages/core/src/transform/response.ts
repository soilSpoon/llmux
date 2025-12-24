import type { ProviderName } from "../providers/base";
import { getProvider } from "../providers/registry";

export interface TransformResponseOptions {
  from: ProviderName;
  to: ProviderName;
}

/**
 * Transform a response from one provider format to another
 *
 * Flow: Source Response → parseResponse() → UnifiedResponse → transformResponse() → Target Response
 */
export function transformResponse(
  response: unknown,
  options: TransformResponseOptions,
): unknown {
  const sourceProvider = getProvider(options.from);
  const targetProvider = getProvider(options.to);

  const unified = sourceProvider.parseResponse(response);
  return targetProvider.transformResponse(unified);
}
