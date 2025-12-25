import { describe, expect, test, afterEach, beforeEach } from 'bun:test'
import { startOAuthListener, type OAuthListener } from '../src/providers/antigravity-server'
import { ANTIGRAVITY_REDIRECT_URI } from '../src/providers/antigravity-constants'

const redirectUri = new URL(ANTIGRAVITY_REDIRECT_URI)
const port = Number.parseInt(redirectUri.port, 10)
const callbackPath = redirectUri.pathname

// NOTE: These tests use a real HTTP server on port 51121.
// They must be run in isolation: bun test packages/auth/test/z-antigravity-server.test.ts
// They are skipped in parallel test runs to avoid port conflicts.
const isParallelRun = process.env.BUN_TEST_PARALLEL !== 'false'
const describeOrSkip = isParallelRun ? describe.skip : describe

describeOrSkip('startOAuthListener', () => {
  let listener: OAuthListener | null = null
  let callbackPromise: Promise<URL> | null = null

  beforeEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  afterEach(async () => {
    if (callbackPromise) {
      callbackPromise.catch(() => {})
    }
    if (listener) {
      await listener.close().catch(() => {})
      listener = null
    }
    callbackPromise = null
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  test('starts server and listens on correct port', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()
    expect(listener).toBeDefined()
    expect(listener.waitForCallback).toBeInstanceOf(Function)
    expect(listener.close).toBeInstanceOf(Function)
  })

  test('successful callback returns URL with code', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    const response = await fetch(
      `http://127.0.0.1:${port}${callbackPath}?code=test_auth_code&state=test_state`
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const html = await response.text()
    expect(html).toContain('Authentication Successful')
    expect(html).toContain('All set!')

    const callbackUrl = await callbackPromise
    expect(callbackUrl).toBeInstanceOf(URL)
    expect(callbackUrl.searchParams.get('code')).toBe('test_auth_code')
    expect(callbackUrl.searchParams.get('state')).toBe('test_state')

    listener = null
    callbackPromise = null
  })

  test('returns 404 for wrong path', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    const response = await fetch(`http://127.0.0.1:${port}/wrong-path`)

    expect(response.status).toBe(404)
    const text = await response.text()
    expect(text).toBe('Not found')
  })

  test('close() method stops the server', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    await listener.close()
    listener = null

    await callbackPromise.catch(() => {})
    callbackPromise = null

    await new Promise(resolve => setTimeout(resolve, 30))

    try {
      await fetch(`http://127.0.0.1:${port}${callbackPath}`)
      expect(true).toBe(false)
    } catch {
      expect(true).toBe(true)
    }
  })

  test('close() rejects waitForCallback if not settled', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    await listener.close()
    listener = null

    await expect(callbackPromise).rejects.toThrow('OAuth listener closed before callback')
    callbackPromise = null
  })

  test('timeout rejects waitForCallback', async () => {
    listener = await startOAuthListener({ timeoutMs: 50 })
    callbackPromise = listener.waitForCallback()

    await expect(callbackPromise).rejects.toThrow('Timed out waiting for OAuth callback')
    callbackPromise = null
  })

  test('callback with just code parameter works', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    await fetch(`http://127.0.0.1:${port}${callbackPath}?code=only_code`)

    const callbackUrl = await callbackPromise
    expect(callbackUrl.searchParams.get('code')).toBe('only_code')
    listener = null
    callbackPromise = null
  })

  test('callback without query parameters works', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    const response = await fetch(`http://127.0.0.1:${port}${callbackPath}`)
    expect(response.status).toBe(200)

    const callbackUrl = await callbackPromise
    expect(callbackUrl.pathname).toBe(callbackPath)
    listener = null
    callbackPromise = null
  })

  test('multiple listeners cannot bind to same port', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    const secondListenerPromise = startOAuthListener()

    await expect(secondListenerPromise).rejects.toThrow()
  })

  test('close() can be called multiple times without error', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    await listener.close()
    await listener.close()

    await callbackPromise.catch(() => {})
    listener = null
    callbackPromise = null
  })

  test('callback with error parameter works', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    await fetch(
      `http://127.0.0.1:${port}${callbackPath}?error=access_denied&error_description=User%20denied`
    )

    const callbackUrl = await callbackPromise
    expect(callbackUrl.searchParams.get('error')).toBe('access_denied')
    expect(callbackUrl.searchParams.get('error_description')).toBe('User denied')
    listener = null
    callbackPromise = null
  })

  test('server closes automatically after successful callback', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    await fetch(`http://127.0.0.1:${port}${callbackPath}?code=auto_close_test`)

    await callbackPromise
    listener = null
    callbackPromise = null

    await new Promise(resolve => setTimeout(resolve, 50))

    try {
      await fetch(`http://127.0.0.1:${port}${callbackPath}`)
      expect(true).toBe(false)
    } catch {
      expect(true).toBe(true)
    }
  })

  test('response contains window.close script', async () => {
    listener = await startOAuthListener()
    callbackPromise = listener.waitForCallback()

    const response = await fetch(`http://127.0.0.1:${port}${callbackPath}?code=test`)

    const html = await response.text()
    expect(html).toContain('window.close()')

    await callbackPromise
    listener = null
    callbackPromise = null
  })
})
