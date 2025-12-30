import * as fs from 'node:fs'
import * as path from 'node:path'
import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'codex-instructions' })

// Get cache directory dynamically (not at module load time)
function getCacheDir(): string {
  return path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.llmux', 'cache')
}

const GITHUB_REPO = 'openai/codex'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// Prompt file mapping per model family
// Based on codex-rs/core/src/model_family.rs logic (matches opencode-openai-codex-auth)
const PROMPT_FILES: Record<string, string> = {
  'gpt-5.2-codex': 'gpt-5.2-codex_prompt.md',
  'codex-max': 'gpt-5.1-codex-max_prompt.md',
  codex: 'gpt_5_codex_prompt.md',
  'gpt-5.2': 'gpt_5_2_prompt.md',
  'gpt-5.1': 'gpt_5_1_prompt.md',
}

// Fallback instructions (bundled)
const FALLBACK_INSTRUCTIONS = `You are GPT-5.1 running in the Codex CLI, a terminal-based coding assistant. You are precise, safe, and helpful.

Your capabilities:
- Receive user prompts and context from files in the workspace
- Communicate with the user by streaming thinking & responses
- Emit function calls to run terminal commands and apply patches

You prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps. You are concise and direct.`

/**
 * Normalize a model name to a family category
 */
function getModelFamily(model: string): string {
  const normalized = model.toLowerCase()

  // Check exact mappings first (for OpenAI Responses API models)
  if (PROMPT_FILES[normalized]) return normalized

  // Then check partial matches for backwards compatibility
  if (normalized.includes('gpt-5.2-codex')) return 'gpt-5.2-codex'
  if (normalized.includes('codex-max')) return 'codex-max'
  if (normalized.includes('gpt-5.2')) return 'gpt-5.2'
  if (normalized.includes('gpt-5.1')) return 'gpt-5.1'
  if (normalized.includes('gpt-5-codex')) return 'gpt-5-codex' // Explicit gpt-5-codex handling
  if (normalized.includes('codex')) return 'codex'

  // Default
  return 'gpt-5.1'
}

/**
 * Get the latest GitHub release tag
 */
async function getLatestReleaseTag(): Promise<string> {
  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    })

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Failed to fetch latest release tag')
      return 'main' // Fallback to main branch
    }

    const data = (await response.json()) as { tag_name?: string }
    const tag = data.tag_name || 'main'
    logger.info({ tag }, 'Got latest GitHub release tag')
    return tag
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Error fetching latest release tag'
    )
    return 'main'
  }
}

/**
 * Load metadata for cached instructions (etag, tag, lastChecked)
 */
function loadMetadata(modelFamily: string): {
  etag?: string
  tag?: string
  lastChecked?: number
} {
  try {
    const metaPath = path.join(getCacheDir(), `${modelFamily}-meta.json`)
    if (fs.existsSync(metaPath)) {
      const content = fs.readFileSync(metaPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to load metadata'
    )
  }
  return {}
}

/**
 * Save metadata for cached instructions
 */
function saveMetadata(
  modelFamily: string,
  metadata: { etag?: string; tag?: string; lastChecked?: number }
): void {
  try {
    const cacheDir = getCacheDir()
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }
    const metaPath = path.join(cacheDir, `${modelFamily}-meta.json`)
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2))
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to save metadata'
    )
  }
}

/**
 * Load cached instructions from disk
 */
function loadCachedInstructions(modelFamily: string): string | null {
  try {
    const cachePath = path.join(getCacheDir(), `${modelFamily}-instructions.md`)
    if (fs.existsSync(cachePath)) {
      return fs.readFileSync(cachePath, 'utf-8')
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to load cached instructions'
    )
  }
  return null
}

/**
 * Save instructions to cache
 */
function saveCachedInstructions(modelFamily: string, instructions: string): void {
  try {
    const cacheDir = getCacheDir()
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }
    const cachePath = path.join(cacheDir, `${modelFamily}-instructions.md`)
    fs.writeFileSync(cachePath, instructions)
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to save cached instructions'
    )
  }
}

/**
 * Fetch Codex instructions from GitHub with ETag-based caching
 * Falls back to disk cache, then bundled fallback
 */
export async function getCodexInstructions(model: string): Promise<string> {
  const modelFamily = getModelFamily(model)
  const promptFile = PROMPT_FILES[modelFamily]

  logger.info(
    { model, modelFamily, promptFile, availableFiles: Object.keys(PROMPT_FILES) },
    '[codex] Fetching Codex instructions'
  )

  // Check cache TTL (15 minutes)
  const metadata = loadMetadata(modelFamily)
  const now = Date.now()
  const ttl = 15 * 60 * 1000 // 15 minutes

  if (metadata.lastChecked && now - metadata.lastChecked < ttl && metadata.tag) {
    // Cache is still fresh
    const cached = loadCachedInstructions(modelFamily)
    if (cached) {
      logger.info(
        { modelFamily, age: now - metadata.lastChecked },
        'Using cached instructions (fresh)'
      )
      return cached
    }
  }

  try {
    // Get the latest release tag
    const tag = await getLatestReleaseTag()
    const urlChanged = metadata.tag !== tag

    // Build raw GitHub URL
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${tag}/codex-rs/core/${promptFile}`

    logger.info({ rawUrl, etag: metadata.etag, urlChanged }, 'Fetching from GitHub')

    // Fetch with ETag if available and URL hasn't changed
    const headers: Record<string, string> = {
      Accept: 'text/plain',
    }
    if (metadata.etag && !urlChanged) {
      headers['If-None-Match'] = metadata.etag
    }

    const response = await fetch(rawUrl, { headers })

    if (response.status === 304) {
      // Not modified, use cached version
      const cached = loadCachedInstructions(modelFamily)
      if (cached) {
        logger.info({ modelFamily }, 'Using cached instructions (304 Not Modified)')
        // Update lastChecked
        saveMetadata(modelFamily, {
          ...metadata,
          lastChecked: now,
        })
        return cached
      }
    }

    if (response.ok) {
      const instructions = await response.text()
      const etag = response.headers.get('etag') || undefined

      logger.debug(
        { modelFamily, instructionsLength: instructions.length, etag },
        '[codex] Received instructions from GitHub'
      )

      // Save to cache
      saveCachedInstructions(modelFamily, instructions)
      saveMetadata(modelFamily, {
        etag,
        tag,
        lastChecked: now,
      })

      logger.info(
        { modelFamily, length: instructions.length, etag },
        '[codex] Fetched and cached new instructions from GitHub'
      )
      return instructions
    } else {
      logger.warn({ modelFamily, status: response.status }, '[codex] Failed to fetch from GitHub')
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Error fetching from GitHub'
    )
  }

  // Fallback: try disk cache
  const cached = loadCachedInstructions(modelFamily)
  if (cached) {
    logger.info({ modelFamily }, 'Using stale cached instructions')
    return cached
  }

  // Final fallback: use bundled fallback
  logger.warn({ modelFamily }, 'Using bundled fallback instructions (network failed, no cache)')
  return FALLBACK_INSTRUCTIONS
}
