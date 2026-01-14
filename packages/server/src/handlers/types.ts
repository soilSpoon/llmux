import type { ProviderName } from '@llmux/core'
import type { ModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import type { Router } from '../routing'
import type { ModelFamily } from './family-rate-limiting'

export interface ProxyOptions {
  sourceFormat: RequestFormat
  targetProvider?: string
  targetModel?: string
  originalModel?: string
  apiKey?: string
  thinking?: boolean
  defaultProvider?: string
  modelMappings?: ModelMapping[]
  router?: Router
}

export interface RetryState {
  attempt: number
  accountIndex: number
  antigravityEndpointIndex: number
  overrideProjectId: string | null
  maxRetryAttempts: number
}

export interface ErrorHandlingContext {
  reqId?: string
  provider: ProviderName
  model: string
  originalModel?: string
  status: number
  errorText: string
  retryState: RetryState
  currentProjectId?: string
  router?: Router
  retryAfterMs?: number
  family?: ModelFamily
  apiKey?: string
}

export interface ErrorHandlingResult {
  action: 'retry' | 'throw' | 'switch-model' | 'all-cooldown'
  newModel?: string
  newProvider?: ProviderName
  delay?: number
}
