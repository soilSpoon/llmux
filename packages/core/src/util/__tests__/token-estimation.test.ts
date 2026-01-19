
import { describe, expect, it } from 'bun:test'
import {
  calculateGeminiTotalInputTokens,
  estimateGeminiImageTokens,
} from '../token-estimation'
import type { GeminiContent } from '../../providers/gemini/types'

describe('estimateGeminiImageTokens', () => {
  it('returns 258 tokens for any image', () => {
    const tokens = estimateGeminiImageTokens({ mimeType: 'image/png', data: '...' })
    expect(tokens).toBe(258)
  })
})

describe('calculateGeminiTotalInputTokens', () => {
  it('returns base tokens if no images are present', () => {
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Hello' }],
      },
    ]
    const baseTokens = 10
    const total = calculateGeminiTotalInputTokens(contents, baseTokens)
    expect(total).toBe(10)
  })

  it('adds tokens for a single image', () => {
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          { text: 'Look at this' },
          { inlineData: { mimeType: 'image/jpeg', data: '...' } },
        ],
      },
    ]
    const baseTokens = 10
    const total = calculateGeminiTotalInputTokens(contents, baseTokens)
    expect(total).toBe(10 + 258)
  })

  it('adds tokens for multiple images across multiple parts', () => {
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: '1' } },
          { text: 'and' },
          { inlineData: { mimeType: 'image/png', data: '2' } },
        ],
      },
    ]
    const baseTokens = 5
    const total = calculateGeminiTotalInputTokens(contents, baseTokens)
    expect(total).toBe(5 + 258 * 2)
  })

  it('handles contents without parts gracefully', () => {
    const contents: GeminiContent[] = [{ role: 'user', parts: [] }]
    const baseTokens = 10
    const total = calculateGeminiTotalInputTokens(contents, baseTokens)
    expect(total).toBe(10)
  })
})
