import type { ModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import type { Router } from '../routing'

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
