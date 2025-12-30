import { createServer } from 'node:http'
import { REDIRECT_URI } from './openai-web'

interface OAuthListenerOptions {
  timeoutMs?: number
}

export interface OAuthListener {
  waitForCallback(): Promise<URL>
  close(): Promise<void>
}

const redirectUri = new URL(REDIRECT_URI)
const callbackPath = redirectUri.pathname || '/'

export async function startOpenAIOAuthListener({
  timeoutMs = 5 * 60 * 1000,
}: OAuthListenerOptions = {}): Promise<OAuthListener> {
  const port = redirectUri.port ? Number.parseInt(redirectUri.port, 10) : 1455 // Default for OpenAI Web Auth
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
    <title>OpenAI Authentication Successful</title>
    <style>
      body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f0f0; margin: 0; }
      .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
      h1 { color: #10B981; margin-top: 0; }
      p { color: #4B5563; line-height: 1.5; }
      .icon { font-size: 3rem; margin-bottom: 1rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">✅</div>
      <h1>Authentication Successful</h1>
      <p>llmux has been successfully authenticated with your OpenAI account.</p>
      <p>You can now close this window and return to your terminal.</p>
    </div>
    <script>
      // Attempt to close the window
      setTimeout(() => {
        window.close();
      }, 3000);
    </script>
  </body>
</html>`

  timeoutHandle = setTimeout(() => {
    rejectCallback(new Error('Timed out waiting for OpenAI OAuth callback'))
  }, timeoutMs)
  if (timeoutHandle.unref) timeoutHandle.unref()

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
          if (error && 'code' in error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
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
