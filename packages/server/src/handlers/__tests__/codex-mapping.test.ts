import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCodexInstructions } from '../codex'

/**
 * Extract the model family from a raw GitHub URL
 * Handles both hyphenated (gpt-5.2-codex_prompt.md) and underscored (gpt_5_1_prompt.md) formats
 */
function extractModelFamilyFromUrl(url: string): string | undefined {
  // Match the filename before _prompt.md
  const match = url.match(/\/([^/]+?)_prompt\.md/)
  if (!match) return undefined
  return match[1]
}

/**
 * Create a mock fetch function that tracks which file was fetched
 */
function createMockFetch(
  onFetch: (modelFamily: string) => void
): typeof globalThis.fetch {
  return mock(async (url: string | URL | Request) => {
    const urlStr = String(url)
    if (urlStr.includes('raw.githubusercontent.com')) {
      const modelFamily = extractModelFamilyFromUrl(urlStr)
      if (modelFamily) {
        onFetch(modelFamily)
      }
      return new Response(`Instructions for ${modelFamily}`, {
        status: 200,
        headers: { etag: `"${Date.now()}-${Math.random()}"` },
      })
    }
    if (urlStr.includes('api.github.com')) {
      return new Response(JSON.stringify({ tag_name: 'v1.0' }), {
        status: 200,
      })
    }
    return new Response('Not found', { status: 404 })
  }) as unknown as typeof globalThis.fetch
}

describe('PROMPT_FILES Model Mapping', () => {
  let tempDir: string
  let originalHome: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), `llmux-codex-mapping-test-${Date.now()}-`))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    originalFetch = globalThis.fetch
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    globalThis.fetch = originalFetch
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore errors
      }
    }
  })

  describe('Model Family Recognition', () => {
    test('gpt-5.2-codex family', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('gpt-5.2-codex')
      expect(fetchedFile).toBe('gpt-5.2-codex')
    })

    test('codex-max family', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('codex-max')
      expect(fetchedFile).toBe('gpt-5.1-codex-max')
    })

    test('gpt-5.2 family', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('gpt-5.2')
      expect(fetchedFile).toBe('gpt_5_2')
    })

    test('gpt-5.1 family', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('gpt-5.1')
      expect(fetchedFile).toBe('gpt_5_1')
    })

    test('codex family (generic)', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('codex')
      expect(fetchedFile).toBe('gpt_5_codex')
    })
  })

  describe('Priority Order - Exact > Partial Match', () => {
    test('exact match takes priority over partial match', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      // "gpt-5.2-codex" matches both:
      // - Exact: gpt-5.2-codex
      // - Partial: gpt-5.2 (contains "gpt-5.2")
      // Should use exact match
      await getCodexInstructions('gpt-5.2-codex')
      expect(fetchedFile).toBe('gpt-5.2-codex')
    })

    test('partial match for variant models', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      // "gpt-5.2-v2" matches:
      // - Partial: gpt-5.2
      // Should use gpt-5.2
      await getCodexInstructions('gpt-5.2-v2')
      expect(fetchedFile).toBe('gpt_5_2')
    })
  })

  describe('Case Insensitivity', () => {
    test('handles uppercase model names', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('GPT-5.2-CODEX')
      expect(fetchedFile).toBe('gpt-5.2-codex')
    })
  })

  describe('Unknown Models - Fallback Behavior', () => {
    test('unknown models default to gpt-5.1', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      await getCodexInstructions('unknown-model')
      expect(fetchedFile).toBe('gpt_5_1') // Default fallback
    })
  })

  describe('Edge Cases', () => {
    test('model names with extra dashes use partial match', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      // gpt-5.2----codex (extra dashes)
      // Contains "gpt-5.2" so should match gpt-5.2 family
      await getCodexInstructions('gpt-5.2----codex')
      expect(fetchedFile).toBe('gpt_5_2')
    })

    test('model names with underscores', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      // Model names shouldn't have underscores but test anyway
      await getCodexInstructions('gpt_5_2')
      // Should fallback to gpt-5.1 since underscores don't match pattern
      expect(fetchedFile).toBe('gpt_5_1')
    })

    test('very long model names with many suffixes', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      // Long name with multiple parts
      await getCodexInstructions('gpt-5.2-codex-advanced-pro-turbo-v2-final')
      // Should still match gpt-5.2-codex pattern
      expect(fetchedFile).toBe('gpt-5.2-codex')
    })

    test('numeric variations in model names', async () => {
      let fetchedFile: string | undefined
      globalThis.fetch = createMockFetch((family) => {
        fetchedFile = family
      })

      // gpt-5.3 (does not match gpt-5.2 or gpt-5.1)
      await getCodexInstructions('gpt-5.3')
      expect(fetchedFile).toBe('gpt_5_1') // Falls back to default
    })
  })

  describe('Model Mapping Integration with Codex Instructions Flow', () => {
    test('correct model family fetches from GitHub', async () => {
      let fetchedUrl: string | undefined
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = String(url)
        if (urlStr.includes('api.github.com')) {
          return new Response(JSON.stringify({ tag_name: 'v1.0' }), {
            status: 200,
          })
        }
        if (urlStr.includes('raw.githubusercontent.com')) {
          fetchedUrl = urlStr
          // Verify the correct filename
          if (urlStr.includes('gpt-5.2-codex_prompt.md')) {
            return new Response('gpt-5.2-codex instructions', {
              status: 200,
              headers: { etag: '"abc"' },
            })
          }
          if (urlStr.includes('gpt_5_1_prompt.md')) {
            return new Response('gpt-5.1 instructions', {
              status: 200,
              headers: { etag: '"abc"' },
            })
          }
        }
        return new Response('Not found', { status: 404 })
      }) as unknown as typeof globalThis.fetch

      // Should fetch gpt-5.2-codex file
      const result = await getCodexInstructions('gpt-5.2-codex')
      expect(result).toContain('gpt-5.2-codex instructions')
      expect(fetchedUrl).toContain('gpt-5.2-codex_prompt.md')
    })

    test('caching uses model family as key (not full model name)', async () => {
      let fetchCount = 0
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = String(url)
        fetchCount++
        if (urlStr.includes('api.github.com')) {
          return new Response(JSON.stringify({ tag_name: 'v1.0' }), {
            status: 200,
          })
        }
        if (urlStr.includes('raw.githubusercontent.com')) {
          return new Response('Instructions', {
            status: 200,
            headers: { etag: '"abc"' },
          })
        }
        return new Response('Not found', { status: 404 })
      }) as unknown as typeof globalThis.fetch

      // First call
      fetchCount = 0
      await getCodexInstructions('gpt-5.2-codex-v1')

      // Second call with different suffix (same family)
      // Should use cache (family is gpt-5.2-codex for both)
      fetchCount = 0
      await getCodexInstructions('gpt-5.2-codex-v2')

      // Should not have fetched again (cache hit)
      // Note: might have 1 fetch for version check, but not content fetch
      expect(fetchCount).toBeLessThanOrEqual(1)
    })
  })
})
