import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, startServer, type LlmuxServer } from '../src/server'

describe('createServer', () => {
  test('creates server with default config', () => {
    const server = createServer()
    expect(server.port).toBe(8743)
    expect(server.hostname).toBe('localhost')
  })

  test('creates server with custom port', () => {
    const server = createServer({ port: 8743 })
    expect(server.port).toBe(8743)
  })

  test('creates server with custom hostname', () => {
    const server = createServer({ hostname: '0.0.0.0' })
    expect(server.hostname).toBe('0.0.0.0')
  })

  test('creates server with corsOrigins', () => {
    const server = createServer({ corsOrigins: ['http://localhost:3000'] })
    expect(server.port).toBe(8743)
  })
})

describe('startServer', () => {
  let server: LlmuxServer | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  test('starts server and assigns random port when port is 0', async () => {
    server = await startServer({ port: 0 })
    expect(server.port).toBeGreaterThan(0)
    expect(server.hostname).toBe('localhost')
  })

  test('starts server on specific port', async () => {
    const port = 19876
    server = await startServer({ port })
    expect(server.port).toBe(port)
  })

  test('stop() shuts down the server', async () => {
    server = await startServer({ port: 0 })
    const port = server.port
    await server.stop()

    const response = await fetch(`http://localhost:${port}/health`).catch(
      () => null
    )
    expect(response).toBeNull()
    server = null
  })

  test('server responds to /health endpoint', async () => {
    server = await startServer({ port: 0 })
    const response = await fetch(`http://localhost:${server.port}/health`)
    expect(response.ok).toBe(true)
    const data = await response.json() as { status: string }
    expect(data.status).toBe('ok')
  })
})
