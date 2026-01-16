import { describe, expect, test } from 'bun:test'
import { parseRetryAfterMs } from '../retry'

describe('parseRetryAfterMs', () => {
  test('should return undefined by default', () => {
    expect(parseRetryAfterMs(new Response())).toBeUndefined()
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
  })

  test('should parse retry-after-ms header', () => {
    const headers = new Headers({ 'retry-after-ms': '5000' })
    const response = new Response(null, { headers })
    expect(parseRetryAfterMs(response)).toBe(5000)
  })

  test('should parse retry-after header (seconds)', () => {
    const headers = new Headers({ 'retry-after': '10' })
    const response = new Response(null, { headers })
    expect(parseRetryAfterMs(response)).toBe(10000)
  })

  test('should prioritize retry-after-ms over retry-after', () => {
    const headers = new Headers({
      'retry-after-ms': '500',
      'retry-after': '10',
    })
    const response = new Response(null, { headers })
    expect(parseRetryAfterMs(response)).toBe(500)
  })

  test('should parse retryDelay from body (Google/Gemini format)', () => {
    const body = JSON.stringify({
      error: {
        message: 'Resource has been exhausted (e.g. check quota).',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            metadata: {
              retryDelay: '3.5s',
            },
          },
        ],
      },
    })
    expect(parseRetryAfterMs(new Response(), body)).toBe(3500)
  })

  test('should parse "reset after" message from body', () => {
    const body = 'Rate limit exceeded. Try again. Quota reset after 45s.'
    expect(parseRetryAfterMs(new Response(), body)).toBe(45000)

    const complexBody = 'exhausted your capacity... reset after 161h1m21s.'
    const expected = (161 * 3600 + 1 * 60 + 21) * 1000
    expect(parseRetryAfterMs(new Response(), complexBody)).toBe(expected)

    const minBody = 'reset after 5m.'
    expect(parseRetryAfterMs(new Response(), minBody)).toBe(5 * 60 * 1000)
  })

  test('should return undefined if body parsing fails', () => {
    const body = JSON.stringify({ error: 'Some other error' })
    expect(parseRetryAfterMs(new Response(), body)).toBeUndefined()
  })

  test('should handle invalid header values gracefully', () => {
    const headers = new Headers({ 'retry-after': 'invalid' })
    const response = new Response(null, { headers })
    expect(parseRetryAfterMs(response)).toBeUndefined()
  })
})
