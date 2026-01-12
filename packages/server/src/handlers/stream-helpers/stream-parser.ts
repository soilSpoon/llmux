import { type FormatContext, type FormatId, getFormat } from '@llmux/core'
import type { StreamChunk } from '@llmux/core/types/unified'

/**
 * Interface for stream parsers that convert raw provider streams to unified StreamChunks
 */
export interface StreamParser {
  parse(chunk: string): StreamChunk | StreamChunk[] | null
  transform(chunk: StreamChunk): string | string[]
}

/**
 * Factory to create appropriate stream parser for formats
 * Now uses Format-based parsing instead of Provider streaming methods
 */
export function createStreamParser(
  sourceFormat: FormatId,
  targetFormat: FormatId,
  ctx: FormatContext
): StreamParser {
  const sourceSchema = getFormat(sourceFormat)
  const targetSchema = getFormat(targetFormat)

  return {
    parse(chunk: string) {
      if (sourceSchema.parseStreamChunk) {
        return sourceSchema.parseStreamChunk(chunk)
      }
      return null
    },
    transform(chunk: StreamChunk) {
      if (targetSchema.buildStreamChunk) {
        return targetSchema.buildStreamChunk(chunk, ctx)
      }
      return ''
    },
  }
}
