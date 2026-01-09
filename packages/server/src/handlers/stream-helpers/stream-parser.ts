import { type FormatId, formatIdToProviderName, getProvider } from '@llmux/core'
import type { ProviderName } from '@llmux/core/providers/base'
import type { StreamChunk } from '@llmux/core/types/unified'

/**
 * Interface for stream parsers that convert raw provider streams to unified StreamChunks
 */
export interface StreamParser {
  parse(chunk: string): StreamChunk | StreamChunk[] | null
  transform(chunk: StreamChunk): string | string[]
}

/**
 * Factory to create appropriate stream parser for a provider
 */
export function createStreamParser(provider: ProviderName, targetFormat: FormatId): StreamParser {
  const sourceProvider = getProvider(provider)
  const targetProvider = getProvider(formatIdToProviderName(targetFormat))

  return {
    parse(chunk: string) {
      if (sourceProvider.parseStreamChunk) {
        return sourceProvider.parseStreamChunk(chunk)
      }
      return null
    },
    transform(chunk: StreamChunk) {
      if (targetProvider.transformStreamChunk) {
        return targetProvider.transformStreamChunk(chunk)
      }
      return ''
    },
  }
}
