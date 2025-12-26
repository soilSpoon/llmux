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
}

export interface RoutingConfig {
  defaultProvider?: ProviderName
  modelMapping?: Record<string, ModelMapping>
  fallbackOrder?: ProviderName[]
  rotateOn429?: boolean
}

export interface AmpModelMapping {
  from: string
  to: string | string[] // 단일 또는 fallback chain
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
    defaultProvider: 'anthropic',
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
  return join(home, '.llmux', 'config.yaml')
}

async function ensureDir(path: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
}

function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let currentSection = ''
  let currentSubSection = ''

  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indentLevel = line.search(/\S/)

    if (indentLevel === 0 && trimmed.endsWith(':')) {
      currentSection = trimmed.slice(0, -1)
      result[currentSection] = {}
      currentSubSection = ''
    } else if (indentLevel === 2 && trimmed.endsWith(':')) {
      currentSubSection = trimmed.slice(0, -1)
      ;(result[currentSection] as Record<string, unknown>)[currentSubSection] = {}
    } else if (indentLevel >= 2) {
      const [key, ...valueParts] = trimmed.split(':')
      const value = valueParts.join(':').trim()

      if (!key || !value) continue

      const parsedValue = parseValue(value)

      if (currentSubSection && indentLevel >= 4) {
        const section = result[currentSection] as Record<string, unknown>
        const subSection = section[currentSubSection] as Record<string, unknown>
        subSection[key] = parsedValue
      } else if (currentSection) {
        ;(result[currentSection] as Record<string, unknown>)[key] = parsedValue
      }
    }
  }

  return result
}

function parseValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
  if (value.startsWith('[') && value.endsWith(']')) {
    const items = value
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
    return items.filter(Boolean)
  }
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

function stringifyYaml(obj: Record<string, unknown>, indent = 0): string {
  const lines: string[] = []
  const prefix = '  '.repeat(indent)

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`)
      lines.push(stringifyYaml(value as Record<string, unknown>, indent + 1))
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}: [${value.join(', ')}]`)
    } else if (typeof value === 'string') {
      lines.push(`${prefix}${key}: ${value}`)
    } else {
      lines.push(`${prefix}${key}: ${value}`)
    }
  }

  return lines.join('\n')
}

export namespace ConfigLoader {
  export function getPath(): string {
    return getConfigPath()
  }

  export async function load(): Promise<LlmuxConfig> {
    try {
      const content = await readFile(getConfigPath(), 'utf-8')
      const parsed = parseYaml(content)
      return merge(getDefault(), parsed as Partial<LlmuxConfig>)
    } catch {
      return getDefault()
    }
  }

  export async function save(config: LlmuxConfig): Promise<void> {
    const path = getConfigPath()
    await ensureDir(path)
    const yaml = stringifyYaml(config as unknown as Record<string, unknown>)
    await writeFile(path, yaml)
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
