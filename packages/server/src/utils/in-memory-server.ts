type InMemoryHandler = (req: Request) => Response | Promise<Response>

const inMemoryServers = new Map<number, InMemoryHandler>()
let fetchHookInstalled = false
let originalFetch: typeof globalThis.fetch | undefined
let nextPort = 40000

function ensureInMemoryFetchHook(): void {
  if (fetchHookInstalled) return
  originalFetch = globalThis.fetch
  const baseFetch = originalFetch

  const patchedFetch: typeof baseFetch = Object.assign(
    async (
      input: Parameters<typeof baseFetch>[0],
      init?: Parameters<typeof baseFetch>[1]
    ): Promise<Response> => {
      const request =
        input instanceof Request
          ? input
          : new Request(input instanceof URL ? input.toString() : input, init)
      const url = new URL(request.url)
      const port = url.port ? Number(url.port) : 0

      if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && port > 0) {
        const handler = inMemoryServers.get(port)
        if (handler) {
          const response = await handler(request)
          const encoding = response.headers.get('Content-Encoding')?.toLowerCase()
          if (encoding === 'gzip') {
            const buffer = Buffer.from(await response.arrayBuffer())
            const decompressed = Bun.gunzipSync(buffer)
            const headers = new Headers(response.headers)
            headers.delete('Content-Encoding')
            return new Response(decompressed, {
              status: response.status,
              statusText: response.statusText,
              headers,
            })
          }
          return response
        }
      }

      if (!baseFetch) {
        throw new Error('Fetch is not available')
      }

      return baseFetch(request)
    },
    baseFetch
  )

  globalThis.fetch = patchedFetch

  fetchHookInstalled = true
}

export function registerInMemoryServer(port: number, handler: InMemoryHandler): void {
  ensureInMemoryFetchHook()
  inMemoryServers.set(port, handler)
}

export function unregisterInMemoryServer(port: number): void {
  inMemoryServers.delete(port)
}

export function createInMemoryServer(handler: InMemoryHandler): { port: number; stop: () => void } {
  const port = nextPort++
  registerInMemoryServer(port, handler)
  return {
    port,
    stop: () => unregisterInMemoryServer(port),
  }
}
