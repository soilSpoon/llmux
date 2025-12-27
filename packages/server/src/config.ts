import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProviderName } from '@llmux/core'

export interface ServerSettings {
  port: number
  hostname: string
  cors: boolean | string[]
}

export interface ModelMapping {
  provider: ProviderName
  model: string
  /**
   * Ordered list of fallback models to try if the primary model fails (e.g. 429).
   * Format: "model-name" (must key into modelMapping or be a valid model ID)
   */
  fallbacks?: string[]
}

export interface RoutingConfig {
  modelMapping?: Record<string, ModelMapping>
  fallbackOrder?: ProviderName[]
  rotateOn429?: boolean
}

export interface AmpModelMapping {
  from: string
  to: string | string[]
}

export interface AmpConfig {
  enabled: boolean
  upstreamUrl: string
  upstreamApiKey?: string
  restrictManagementToLocalhost?: boolean
  modelMappings?: AmpModelMapping[]
}

export interface LlmuxConfig {
  server: ServerSettings
  routing: RoutingConfig
  amp: AmpConfig
}

const DEFAULT_CONFIG: LlmuxConfig = {
  server: {
    port: 8743,
    hostname: 'localhost',
    cors: true,
  },
  routing: {
    fallbackOrder: ['anthropic', 'openai', 'gemini'],
    rotateOn429: true,
  },
  amp: {
    enabled: true,
    upstreamUrl: 'https://ampcode.com',
    restrictManagementToLocalhost: false,
  },
}

function getConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~'
  return join(home, '.llmux', 'config.json')
}

async function ensureDir(path: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
}

export namespace ConfigLoader {
  export function getPath(): string {
    return getConfigPath()
  }

  export async function load(): Promise<LlmuxConfig> {
    try {
      const content = await readFile(getConfigPath(), 'utf-8')
      const parsed = JSON.parse(content)
      return merge(getDefault(), parsed as Partial<LlmuxConfig>)
    } catch {
      return getDefault()
    }
  }

  export async function save(config: LlmuxConfig): Promise<void> {
    const path = getConfigPath()
    await ensureDir(path)
    await writeFile(path, JSON.stringify(config, null, 2))
  }

  export async function get<K extends keyof LlmuxConfig>(section: K): Promise<LlmuxConfig[K]> {
    const config = await load()
    return config[section]
  }

  export async function set<K extends keyof LlmuxConfig>(
    section: K,
    value: LlmuxConfig[K]
  ): Promise<void> {
    const config = await load()
    config[section] = value
    await save(config)
  }

  export function getDefault(): LlmuxConfig {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as LlmuxConfig
  }
}

function merge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base }
  for (const key of Object.keys(override) as (keyof T)[]) {
    const value = override[key]
    if (value !== undefined) {
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        result[key] = merge(result[key] as object, value as object) as T[keyof T]
      } else {
        result[key] = value as T[keyof T]
      }
    }
  }
  return result
}
