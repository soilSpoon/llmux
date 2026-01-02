import { CredentialStorage, isApiKeyCredential, isOAuthCredential } from '@llmux/auth'
import type { UsageInfo } from '@llmux/core'
import { globalCooldownManager } from '../cooldown'

export interface StatusResponse {
  version: 1
  timestamp: string // ISO-8601
  serverTimeMs: number

  providers: ProviderStatus[]
  cooldowns: Record<string, CooldownEntry> // keyed by cooldown key
}

export interface ProviderStatus {
  id: string

  auth: ProviderAuthStatus

  // Cooldowns relevant to this provider
  cooldowns: CooldownEntry[]

  // Optional usage/limits for UI; mostly null/empty initially
  usage?: ProviderUsageStatus
}

export type ProviderAuthStatus =
  | { status: 'missing' }
  | {
      status: 'valid' | 'expired'
      type: 'oauth' | 'api'
      // Only non-sensitive metadata; no tokens
      email?: string
      projectId?: string
      expiresAt?: number
      expiresInMs?: number
      lastRefresh?: string
    }

export interface CooldownEntry {
  key: string // same key passed into CooldownManager (e.g. 'openai-web:gpt-4.1-mini')
  providerId: string // derived from key (e.g. 'openai-web')
  resetAt: number
  remainingMs: number
  backoffLevel: number
  active: boolean
}

export interface ProviderUsageStatus {
  window: 'lifetime' | 'day' | 'hour' | 'unknown'
  // reuse existing UsageInfo for totals
  totals?: UsageInfo
  // Optional quotas/limits, if we have them
  limitTokens?: number
  remainingTokens?: number
  lastUpdated?: string
}

export async function handleStatus(_request: Request): Promise<Response> {
  const now = Date.now()

  // 1. Collect auth status per provider
  const credentialsByProvider = await CredentialStorage.all()
  const providerAuthMap = new Map<string, ProviderStatus>()

  const providerIds = new Set(Object.keys(credentialsByProvider))

  // Also incorporate providers seen only in cooldowns later
  // We'll handle that in the cooldown loop or by merging keys

  for (const id of providerIds) {
    const creds = credentialsByProvider[id] ?? []

    let providerStatus: ProviderStatus

    if (creds.length === 0) {
      providerStatus = { id, auth: { status: 'missing' }, cooldowns: [] }
    } else {
      // For now, just pick the "primary" credential (e.g. the first oauth or api)
      const oauth = creds.find(isOAuthCredential)
      const api = creds.find(isApiKeyCredential)

      if (oauth) {
        const expiresAt = oauth.expiresAt
        const expiresInMs = expiresAt ? expiresAt - now : undefined
        const expired = expiresAt ? expiresAt <= now : false

        providerStatus = {
          id,
          auth: {
            status: expired ? 'expired' : 'valid',
            type: 'oauth',
            email: oauth.email,
            expiresAt,
            expiresInMs,
            lastRefresh: oauth.lastRefresh,
          },
          cooldowns: [],
        }
      } else if (api) {
        providerStatus = {
          id,
          auth: {
            status: 'valid',
            type: 'api',
          },
          cooldowns: [],
        }
      } else {
        providerStatus = { id, auth: { status: 'missing' }, cooldowns: [] }
      }
    }

    providerAuthMap.set(id, providerStatus)
  }

  // 2. Collect cooldowns
  const cooldownEntries: CooldownEntry[] = []
  for (const { key, resetAt, backoffLevel } of globalCooldownManager.getAll()) {
    const remainingMs = Math.max(0, resetAt - now)
    const active = remainingMs > 0
    const providerId = key.split(':')[0] ?? 'unknown'

    const entry: CooldownEntry = {
      key,
      providerId,
      resetAt,
      remainingMs,
      backoffLevel,
      active,
    }
    cooldownEntries.push(entry)

    // Attach to provider status
    const provider = providerAuthMap.get(providerId) ?? {
      id: providerId,
      auth: { status: 'missing' },
      cooldowns: [],
    }

    // If it wasn't in the map (no creds but has cooldowns), we initialize it
    if (!provider.cooldowns) {
      provider.cooldowns = []
    }
    provider.cooldowns.push(entry)
    providerAuthMap.set(providerId, provider)
  }

  const response: StatusResponse = {
    version: 1,
    timestamp: new Date(now).toISOString(),
    serverTimeMs: now,
    providers: Array.from(providerAuthMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
    cooldowns: Object.fromEntries(cooldownEntries.map((c) => [c.key, c])),
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
