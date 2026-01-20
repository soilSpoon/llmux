/**
 * Token Estimation Utilities
 *
 * Provides utilities for estimating token counts, especially for complex content
 * like images where provider-specific logic is required.
 */

import type { GeminiContent } from '../providers/gemini/types'

/**
 * Image data structure for token estimation
 */
export interface ImageData {
  mimeType: string
  data: string
}

/**
 * Estimates token count for an image in Gemini.
 * Gemini documentation states images are charged a fixed token amount.
 * As of 2024, this is typically 258 tokens per image.
 *
 * @param imageData The image to estimate tokens for
 * @returns The estimated token count (258)
 */
export function estimateGeminiImageTokens(_imageData: ImageData): number {
  // Gemini charges a flat rate per image regardless of size/resolution
  // Documented value is often 258 tokens
  return 258
}

/**
 * Calculates total input tokens for a Gemini request, including image tokens.
 *
 * @param contents The Gemini content parts
 * @param baseTextTokens The token count for text parts (usually from usage metadata)
 * @returns Total input tokens including images
 */
export function calculateGeminiTotalInputTokens(
  contents: GeminiContent[],
  baseTextTokens: number
): number {
  let imageTokens = 0

  for (const content of contents) {
    if (!content.parts) continue

    for (const part of content.parts) {
      if ('inlineData' in part && part.inlineData) {
        imageTokens += estimateGeminiImageTokens(part.inlineData)
      }
    }
  }

  // If the API provided a count, it likely already includes images,
  // but this helper is useful when we need to estimate before sending
  // or verify counts.
  //
  // However, usually we use this to *augment* usage info if the provider
  // didn't return it, or to cross-check.
  //
  // For the specific user story (US-014), we need to integrate this
  // into accumulateGeminiResponse.
  return baseTextTokens + imageTokens
}
