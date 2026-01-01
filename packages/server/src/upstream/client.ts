import type { UpstreamProvider } from './types'

export interface UpstreamRequestOptions {
  provider: UpstreamProvider | string
  endpoint: string
  headers: Record<string, string>
  body: unknown
  signal?: AbortSignal
}

export async function callUpstream(options: UpstreamRequestOptions): Promise<Response> {
  return fetch(options.endpoint, {
    method: 'POST',
    headers: options.headers,
    body: JSON.stringify(options.body),
    signal: options.signal,
  })
}
