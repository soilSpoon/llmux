import { describe, expect, test } from 'bun:test'
import { handleHealth } from '../../src/handlers/health'

describe('handleHealth', () => {
  test('returns ok status', async () => {
    const request = new Request('http://localhost/health')
    const response = await handleHealth(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  test('returns version', async () => {
    const request = new Request('http://localhost/health')
    const response = await handleHealth(request)

    const data = await response.json()
    expect(data.version).toBe('0.1.0')
  })

  test('returns correct content-type', async () => {
    const request = new Request('http://localhost/health')
    const response = await handleHealth(request)

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })
})
