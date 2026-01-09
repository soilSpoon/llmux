import type { FormatId } from '@llmux/core'
import { detectFormatFromUrl } from '@llmux/core'

export type RequestFormat = FormatId

/**
 * Detect the request format from URL
 *
 * @param url The request URL path
 * @throws Error (400) if format cannot be detected from URL
 */
export function detectFormat(url: string): FormatId {
  const fromUrl = detectFormatFromUrl(url)
  if (fromUrl) return fromUrl

  throw new Error(
    'Unknown request format. Please use a standard API endpoint like /v1/chat/completions'
  )
}
