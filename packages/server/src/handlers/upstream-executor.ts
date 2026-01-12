import { SignatureStore } from '../stores'
import type { ProxyOptions } from './types'
import {
  dispatchWithRetry,
  NonRetriableError,
  type UpstreamRequestMeta,
} from './upstream-dispatcher'
import { buildUpstreamRequest } from './upstream-request-builder'

// 공유 SignatureStore 인스턴스
const signatureStore = new SignatureStore()

export function getSignatureStore(): SignatureStore {
  return signatureStore
}

export interface ExecuteUpstreamOptions {
  reqId: string
  body: Record<string, unknown>
  options: ProxyOptions
  mode: 'streaming' | 'non-streaming'
  onBeforeAttempt?: (attempt: number, meta: UpstreamRequestMeta) => void
}

export interface ExecuteUpstreamResult {
  response: Response
  meta: {
    provider: string
    model: string
    originalModel: string
    currentProjectId?: string
    isClaudeFresh?: boolean
  }
}

export async function executeUpstream(
  opts: ExecuteUpstreamOptions
): Promise<ExecuteUpstreamResult> {
  // Implement using dispatchWithRetry logic extracted from streaming.ts/proxy.ts
  const { reqId, body, options, mode, onBeforeAttempt } = opts

  const dispatchResult = await dispatchWithRetry({
    reqId,
    builder: buildUpstreamRequest,
    initialBody: body,
    options,
    mode,
    signatureStore,
    onBeforeAttempt,
  })

  if (!dispatchResult.response) {
    throw new Error('No response from dispatcher')
  }

  const defaultMeta = {
    provider: 'unknown',
    model: 'unknown',
    originalModel: 'unknown',
  }

  return {
    response: dispatchResult.response,
    meta: dispatchResult.meta || defaultMeta,
  }
}

// Re-export for convenience
export { NonRetriableError }
