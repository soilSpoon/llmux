import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'upstream-proxy' })

export interface UpstreamProxyConfig {
  targetUrl: string
  apiKey?: string
}

export interface UpstreamProxy {
  proxyRequest(request: Request): Promise<Response>
  targetUrl: string
}

/**
 * Check if response is a streaming response (SSE)
 */
function isStreamingResponse(headers: Headers): boolean {
  const contentType = headers.get('Content-Type') || ''
  return contentType.includes('text/event-stream')
}

export function createUpstreamProxy(config: UpstreamProxyConfig): UpstreamProxy {
  if (!config.targetUrl) {
    throw new Error('targetUrl is required')
  }

  const targetUrl = config.targetUrl.replace(/\/$/, '')

  return {
    targetUrl,
    async proxyRequest(request: Request): Promise<Response> {
      const startTime = Date.now()
      const reqId = Math.random().toString(36).slice(2, 8)
      const url = new URL(request.url)
      const proxyUrl = `${targetUrl}${url.pathname}${url.search}`

      // Request Capture
      const requestHeaders: Record<string, string> = {}
      request.headers.forEach((value, key) => {
        requestHeaders[key] = value
      })

      // Read body once to avoid "Body already used" errors
      let bodyBuffer: ArrayBuffer | undefined
      let bodyText = ''

      try {
        bodyBuffer = await request.arrayBuffer()
        if (bodyBuffer.byteLength > 0) {
          bodyText = new TextDecoder().decode(bodyBuffer)
        }
      } catch (_e) {
        // Body might be empty or not readable
      }

      let requestBodyPreview = 'empty'
      const inputBodyLength = bodyBuffer?.byteLength || 0
      let apiMethod = 'unknown'

      if (bodyText) {
        requestBodyPreview = bodyText.slice(0, 500) + (bodyText.length > 500 ? '...' : '')
        // Extract API method from request body for logging
        try {
          const parsed = JSON.parse(bodyText)
          apiMethod = parsed.method || 'unknown'
        } catch {
          apiMethod = 'parse-error'
        }
        // Detailed debug log (only when LOG_LEVEL=debug)
        // If path starts with /api/internal, use trace level to reduce noise
        const isInternal = url.pathname.startsWith('/api/internal')
        const logFn = isInternal ? logger.trace.bind(logger) : logger.debug.bind(logger)

        logFn(
          {
            reqId,
            method: request.method,
            path: url.pathname,
            proxyUrl,
            bodyLength: bodyText.length,
            apiMethod,
          },
          '[DEBUG] Request details'
        )
      }

      try {
        // Build filtered headers
        const filteredHeaders = new Headers()
        request.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'host') return
          filteredHeaders.set(key, value)
        })

        if (config.apiKey) {
          filteredHeaders.set('Authorization', `Bearer ${config.apiKey}`)
        }

        // Log transformed request before sending (for debugging schema issues)
        if (url.pathname.includes('/api/provider/')) {
          const headersObj: Record<string, string> = {}
          filteredHeaders.forEach((v, k) => {
            headersObj[k] = k.toLowerCase().includes('auth') ? '[REDACTED]' : v
          })
          logger.debug(
            {
              reqId,
              proxyUrl,
              method: request.method,
              headers: headersObj,
              bodyPreview: requestBodyPreview.slice(0, 1000),
            },
            '[Proxy] Request to upstream (pre-fetch)'
          )
        }

        const fetchOptions: RequestInit & { duplex?: 'half' } = {
          method: request.method,
          headers: filteredHeaders,
          body: bodyBuffer ? new Uint8Array(bodyBuffer) : undefined,
        }

        if (bodyBuffer) {
          fetchOptions.duplex = 'half'
        }

        const upstreamResponse = await fetch(proxyUrl, fetchOptions)

        // Log warning/error for non-2xx responses with full request/response details
        if (!upstreamResponse.ok) {
          const responseText = await upstreamResponse.clone().text()
          const headersObj: Record<string, string> = {}
          filteredHeaders.forEach((v, k) => {
            headersObj[k] =
              k.toLowerCase().includes('auth') || k.toLowerCase().includes('key') ? '[REDACTED]' : v
          })
          const responseHeadersObj: Record<string, string> = {}
          upstreamResponse.headers.forEach((v, k) => {
            responseHeadersObj[k] = v
          })

          const logLevel = upstreamResponse.status >= 500 ? 'error' : 'warn'
          const logData = {
            reqId,
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            proxyUrl,
            request: {
              method: request.method,
              headers: headersObj,
              body: bodyText.slice(0, 2000),
            },
            response: {
              headers: responseHeadersObj,
              body: responseText.slice(0, 2000),
            },
          }

          if (logLevel === 'error') {
            logger.error(logData, `[Proxy] Upstream returned ${upstreamResponse.status}`)
          } else {
            logger.warn(logData, `[Proxy] Upstream returned ${upstreamResponse.status}`)
          }
        }

        // For streaming responses or non-2xx responses, pass through without modification
        // But still strip Content-Encoding header for streaming too
        if (isStreamingResponse(upstreamResponse.headers)) {
          const duration = Date.now() - startTime
          logger.info(
            `[Proxy] ${reqId} | ${request.method} ${url.pathname} | ReqLen:${inputBodyLength} | Status:${upstreamResponse.status} | ${duration}ms | (streaming passthrough)`
          )
          // Even for streaming, we need to strip Content-Encoding since Bun auto-decompresses
          const streamHeaders = new Headers()
          upstreamResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'content-encoding') return
            streamHeaders.set(key, value)
          })
          return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: streamHeaders,
          })
        }

        // Read response body
        // Note: Bun's fetch() automatically decompresses gzip responses
        const responseBuffer = await upstreamResponse.arrayBuffer()
        const responseData = new Uint8Array(responseBuffer)

        // Response logging
        let responsePreview = 'empty'
        let errorDetails = null
        const outputBodyLength = responseData.length
        try {
          const responseText = new TextDecoder().decode(responseData)
          if (responseText) {
            responsePreview = responseText.slice(0, 500) + (responseText.length > 500 ? '...' : '')
            // Extract error details if response contains error
            try {
              const parsed = JSON.parse(responseText)
              if (parsed.error) {
                errorDetails = parsed.error
              }
            } catch {
              // Not JSON or no error field
            }

            const isInternal = url.pathname.startsWith('/api/internal')
            const logFn = isInternal ? logger.trace.bind(logger) : logger.debug.bind(logger)

            logFn(
              {
                reqId,
                status: upstreamResponse.status,
                responseLength: responseText.length,
                apiMethod,
                errorDetails,
              },
              '[DEBUG] Response details'
            )
          }
        } catch (_e) {
          responsePreview = '<error reading response>'
        }

        const duration = Date.now() - startTime

        // Helper: sanitize to single line (remove newlines/carriage returns)
        const sanitize = (s: string) =>
          s
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        // SINGLE CONSOLIDATED LOG LINE (Request + Response combined)
        const logLine = `[Proxy] ${reqId} | ${request.method} ${
          url.pathname
        } | ReqLen:${inputBodyLength} | Status:${
          upstreamResponse.status
        } | ${duration}ms | ResLen:${outputBodyLength} | Req: ${sanitize(requestBodyPreview).slice(
          0,
          200
        )} | Res: ${sanitize(responsePreview).slice(0, 200)}`

        // Log sensitive internal endpoints at trace level to avoid spamming info logs
        if (url.pathname.startsWith('/api/internal')) {
          logger.trace(logLine)
        } else {
          logger.info(logLine)
        }

        // Build response headers
        // IMPORTANT: Always remove Content-Encoding because Bun's fetch()
        // automatically decompresses gzip responses but keeps the header.
        // This causes clients to try to decompress already-decompressed data.
        const responseHeaders = new Headers()
        upstreamResponse.headers.forEach((value, key) => {
          const lowerKey = key.toLowerCase()
          // Always skip Content-Encoding (Bun auto-decompresses)
          if (lowerKey === 'content-encoding') return
          // Skip Content-Length to use chunked transfer encoding (like Go proxy)
          if (lowerKey === 'content-length') return
          // Skip Transfer-Encoding as we'll let the runtime handle it
          if (lowerKey === 'transfer-encoding') return
          responseHeaders.set(key, value)
        })
        // Don't set Content-Length - this enables chunked transfer encoding

        // Use ReadableStream for chunked transfer encoding (matches Go proxy behavior)
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(responseData)
            controller.close()
          },
        })

        return new Response(stream, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        })
      } catch (error) {
        const duration = Date.now() - startTime
        const message = error instanceof Error ? error.message : 'Network error'
        logger.error({ reqId, error: message, duration }, 'Upstream proxy error')
        return new Response(JSON.stringify({ error: message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    },
  }
}
