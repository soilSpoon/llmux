import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'upstream-proxy' })

export interface UpstreamProxyConfig {
  targetUrl: string
  apiKey?: string
}

export interface UpstreamProxy {
  proxyRequest(request: Request): Promise<Response>
}

export function createUpstreamProxy(config: UpstreamProxyConfig): UpstreamProxy {
  if (!config.targetUrl) {
    throw new Error('targetUrl is required')
  }

  const targetUrl = config.targetUrl.replace(/\/$/, '')

  return {
    async proxyRequest(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const proxyUrl = `${targetUrl}${url.pathname}${url.search}`

      logger.debug({ method: request.method, path: url.pathname, proxyUrl }, 'Proxying request')

      try {
        const headers = new Headers()
        request.headers.forEach((value, key) => {
          const lowerKey = key.toLowerCase()
          if (lowerKey === 'host') return
          if (lowerKey === 'authorization' && config.apiKey) return
          headers.set(key, value)
        })

        if (config.apiKey) {
          headers.set('Authorization', `Bearer ${config.apiKey}`)
        }

        let body: ArrayBuffer | null = null
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          body = await request.arrayBuffer()
        }

        const upstreamResponse = await fetch(proxyUrl, {
          method: request.method,
          headers,
          body,
        })

        logger.debug(
          {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
          },
          'Upstream response'
        )

        const responseHeaders = new Headers()
        upstreamResponse.headers.forEach((value, key) => {
          responseHeaders.set(key, value)
        })

        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Network error'
        logger.error({ error: message }, 'Upstream proxy error')
        return new Response(JSON.stringify({ error: message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    },
  }
}
