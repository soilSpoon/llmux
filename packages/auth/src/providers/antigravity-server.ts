import { createServer } from 'node:http'
import { ANTIGRAVITY_REDIRECT_URI } from './antigravity-constants'

interface OAuthListenerOptions {
  timeoutMs?: number
}

export interface OAuthListener {
  waitForCallback(): Promise<URL>
  close(): Promise<void>
}

const redirectUri = new URL(ANTIGRAVITY_REDIRECT_URI)
const callbackPath = redirectUri.pathname || '/'

export async function startOAuthListener({
  timeoutMs = 5 * 60 * 1000,
}: OAuthListenerOptions = {}): Promise<OAuthListener> {
  const port = redirectUri.port
    ? Number.parseInt(redirectUri.port, 10)
    : redirectUri.protocol === 'https:'
      ? 443
      : 80
  const origin = `${redirectUri.protocol}//${redirectUri.host}`

  let settled = false
  let resolveCallback: (url: URL) => void
  let rejectCallback: (error: Error) => void
  let timeoutHandle: NodeJS.Timeout

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url: URL) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve(url)
    }
    rejectCallback = (error: Error) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      reject(error)
    }
  })

  const successResponse = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authentication Successful</title>
    <style>
      body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f0f0; }
      .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
      h1 { color: #10B981; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>All set!</h1>
      <p>You've successfully authenticated with Antigravity. You can close this tab.</p>
    </div>
    <script>window.close()</script>
  </body>
</html>`

  timeoutHandle = setTimeout(() => {
    rejectCallback(new Error('Timed out waiting for OAuth callback'))
  }, timeoutMs)
  timeoutHandle.unref?.()

  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400, { 'Content-Type': 'text/plain' })
      response.end('Invalid request')
      return
    }

    const url = new URL(request.url, origin)
    if (url.pathname !== callbackPath) {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('Not found')
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(successResponse)

    resolveCallback(url)

    setImmediate(() => {
      server.close()
    })
  })

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('error', handleError)
      reject(error)
    }
    server.once('error', handleError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', handleError)
      resolve()
    })
  })

  server.on('error', (error) => {
    rejectCallback(error instanceof Error ? error : new Error(String(error)))
  })

  return {
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error)
            return
          }
          if (!settled) {
            rejectCallback(new Error('OAuth listener closed before callback'))
          }
          resolve()
        })
      }),
  }
}
