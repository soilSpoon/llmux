import { describe, expect, it } from 'bun:test'
import { parseNestedJson, parseUpstreamError, createErrorResponse } from '../error-utils'

describe('parseNestedJson', () => {
  it('should parse simple JSON string', () => {
    const input = '{"key": "value"}'
    expect(parseNestedJson(input)).toEqual({ key: 'value' })
  })

  it('should recursively parse nested JSON strings', () => {
    const inner = JSON.stringify({ type: 'error', message: 'inner error' })
    const outer = { error: { message: inner } }
    const result = parseNestedJson(outer) as Record<string, unknown>
    const error = result.error as Record<string, unknown>
    const message = error.message as Record<string, unknown>
    expect(message.type).toBe('error')
    expect(message.message).toBe('inner error')
  })

  it('should handle non-JSON strings', () => {
    expect(parseNestedJson('plain text')).toBe('plain text')
  })

  it('should handle arrays', () => {
    const input = ['{"a":1}', 'plain']
    const result = parseNestedJson(input) as unknown[]
    expect(result[0]).toEqual({ a: 1 })
    expect(result[1]).toBe('plain')
  })
})

describe('parseUpstreamError', () => {
  it('should parse Vertex-wrapped Anthropic error', () => {
    const anthropicError = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Prompt is too long',
      },
      request_id: 'req_vrtx_011CWkBtk4zEoA6xgYQys5JL',
    }
    const vertexError = {
      error: {
        code: 400,
        message: JSON.stringify(anthropicError),
        status: 'FAILED_PRECONDITION',
      },
    }
    const errorText = JSON.stringify(vertexError)

    const result = parseUpstreamError(errorText, 400)

    expect(result.message).toBe('Prompt is too long')
    expect(result.type).toBe('invalid_request_error')
    expect(result.status).toBe(400)
    expect(result.request_id).toBe('req_vrtx_011CWkBtk4zEoA6xgYQys5JL')
    expect(result.details).toBeDefined()
  })

  it('should handle simple error text', () => {
    const result = parseUpstreamError('Connection refused', 502)
    expect(result.message).toBe('Connection refused')
    expect(result.status).toBe(502)
  })

  it('should handle direct Anthropic error', () => {
    const error = {
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: 'Rate limit exceeded',
      },
    }
    const result = parseUpstreamError(JSON.stringify(error), 429)
    expect(result.message).toBe('Rate limit exceeded')
    expect(result.type).toBe('rate_limit_error')
  })

  it('should handle OpenAI-style error', () => {
    const error = {
      error: {
        message: 'Invalid API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    }
    const result = parseUpstreamError(JSON.stringify(error), 401)
    expect(result.message).toBe('Invalid API key')
    expect(result.type).toBe('invalid_request_error')
    expect(result.code).toBe('invalid_api_key')
  })
})

describe('createErrorResponse', () => {
  it('should create structured error response', () => {
    const info = {
      message: 'Test error',
      status: 400,
      type: 'invalid_request_error',
      provider: 'antigravity',
    }
    const result = createErrorResponse(info)
    expect(result.error.message).toBe('Test error')
    expect(result.error.status).toBe(400)
    expect(result.error.type).toBe('invalid_request_error')
    expect(result.error.provider).toBe('antigravity')
  })

  it('should omit undefined fields', () => {
    const info = { message: 'Simple error', status: 500 }
    const result = createErrorResponse(info)
    expect(result.error).toEqual({ message: 'Simple error', status: 500 })
    expect('type' in result.error).toBe(false)
  })
})
