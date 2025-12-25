import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import '../setup'
import { startServer, type LlmuxServer } from '../../src/server'

describe('/providers endpoint', () => {
  let server: LlmuxServer
  let baseUrl: string

  beforeAll(async () => {
    server = await startServer({ port: 0 })
    baseUrl = `http://${server.hostname}:${server.port}`
  })

  afterAll(async () => {
    await server.stop()
  })

  test('GET /providers returns list of providers', async () => {
    const response = await fetch(`${baseUrl}/providers`)
    expect(response.status).toBe(200)

    const data = (await response.json()) as { providers: string[] }
    expect(data.providers).toBeDefined()
    expect(Array.isArray(data.providers)).toBe(true)
  })

  test('GET /providers includes registered providers', async () => {
    const response = await fetch(`${baseUrl}/providers`)
    const data = (await response.json()) as { providers: string[] }

    expect(data.providers).toContain('openai')
    expect(data.providers).toContain('anthropic')
    expect(data.providers).toContain('gemini')
  })

  test('GET /providers returns JSON content type', async () => {
    const response = await fetch(`${baseUrl}/providers`)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
