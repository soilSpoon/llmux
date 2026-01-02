import type { AmpModelMapping } from '../config'
import type { RequestFormat } from '../middleware/format'
import type { Router } from '../routing'

export interface ProxyOptions {
  sourceFormat: RequestFormat
  targetProvider?: string
  targetModel?: string
  apiKey?: string
  thinking?: boolean
  modelMappings?: AmpModelMapping[]
  router?: Router
}
