import { describe, expect, test } from 'bun:test'
import {
  buildResponseHeaders,
  createErrorResponse,
  createJsonResponse,
} from '../../src/handlers/response-headers'

describe('Response Headers Utils', () => {
  describe('buildResponseHeaders', () => {
    test('should return default headers', () => {
      const headers = buildResponseHeaders()
      expect(headers.get('content-type')).toBe('application/json; charset=UTF-8')
      expect(headers.get('cache-control')).toBe('no-cache, no-store')
      expect(headers.get('x-content-type-options')).toBe('nosniff')
      expect(headers.get('x-powered-by')).toBe('llmux')
    })

    test('should preserve allowed upstream headers', () => {
      const upstream = new Headers({
        'x-request-id': 'req-123',
        'x-trace-id': 'trace-456',
        'x-amp-request-id': 'amp-789',
        'retry-after': '10',
        'server': 'nginx', // Should be ignored
      })

      const headers = buildResponseHeaders({ upstreamHeaders: upstream })
      
      expect(headers.get('x-request-id')).toBe('req-123')
      expect(headers.get('x-trace-id')).toBe('trace-456')
      expect(headers.get('x-amp-request-id')).toBe('amp-789')
      expect(headers.get('retry-after')).toBe('10')
      expect(headers.get('server')).toBeNull()
    })

    test('should set request ID if not present', () => {
      const headers = buildResponseHeaders({ requestId: 'new-req-id' })
      expect(headers.get('x-request-id')).toBe('new-req-id')
    })

    test('should prefer upstream request ID over generated one', () => {
      const upstream = new Headers({ 'x-request-id': 'upstream-id' })
      const headers = buildResponseHeaders({ 
        upstreamHeaders: upstream, 
        requestId: 'generated-id' 
      })
      expect(headers.get('x-request-id')).toBe('upstream-id')
    })

    test('should add extra headers', () => {
      const headers = buildResponseHeaders({
        extras: { 'x-custom-header': 'custom-value' }
      })
      expect(headers.get('x-custom-header')).toBe('custom-value')
    })

    test('should override content type', () => {
      const headers = buildResponseHeaders({
        contentType: 'text/event-stream'
      })
      expect(headers.get('content-type')).toBe('text/event-stream')
    })
  })

  describe('createJsonResponse', () => {
    test('should create response with correct body and status', async () => {
      const body = { success: true }
      const res = createJsonResponse(body, 201)
      
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual(body)
      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })

  describe('createErrorResponse', () => {
    test('should create standardized error response', async () => {
      const res = createErrorResponse('Something went wrong', 400, {
        type: 'validation_error',
        code: 'INVALID_INPUT'
      })
      
      expect(res.status).toBe(400)
      const body = await res.json() as any
      
      expect(body.error).toEqual({
        message: 'Something went wrong',
        type: 'validation_error',
        code: 'INVALID_INPUT'
      })
    })

    test('should use default error type', async () => {
      const res = createErrorResponse('Error', 500)
      const body = await res.json() as any
      expect(body.error.type).toBe('proxy_error')
      expect(body.error.code).toBeNull()
    })
  })
})
