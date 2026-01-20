import type { AntigravityContent } from '../antigravity/types.js'
import { resolveGeminiFamilyCapabilities } from '../capabilities.js'

/**
 * US-009: Cross-Model Signature Sanitizer
 */

export function sanitizeCrossModelPayload(
  contents: AntigravityContent[],
  targetModel: string
): AntigravityContent[] {
  const caps = resolveGeminiFamilyCapabilities(targetModel)
  const isClaude = caps.modelVendor === 'anthropic'

  return contents.map((content) => ({
    ...content,
    parts: content.parts.map((part) => {
      // 2. Gemini -> Claude: Gemini thoughtSignature 제거
      if (isClaude && 'thoughtSignature' in part) {
        const { thoughtSignature, ...rest } = part
        return rest
      }

      return part
    }),
  }))
}
