import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import '../../../test/setup'
import type { AmpModelMapping } from '../../config'
import { handleResponses, type ResponsesOptions } from '../responses'

describe('handleResponses', () => {
  let originalFetch: typeof globalThis.fetch
  let capturedBody: unknown
  let capturedUrl: string
  let capturedHeaders: Record<string, string>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    capturedBody = undefined
    capturedUrl = ''
    capturedHeaders = {}
    globalThis.fetch = Object.assign(
      mock(async (url: string, options?: { body?: string; headers?: Record<string, string> }) => {
        capturedUrl = url
        if (options?.body) {
          capturedBody = JSON.parse(options.body)
        }
        if (options?.headers) {
          capturedHeaders = options.headers
        }
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello!' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }),
      { preconnect: () => {} }
    ) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function createRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const baseOptions: ResponsesOptions = {
    targetProvider: 'openai',
    apiKey: 'test-api-key',
  }

  describe('Non-streaming 요청/응답', () => {
    it('ResponsesRequest를 ChatCompletions로 변환하고 호출한다', async () => {
      const request = createRequest({
        model: 'gpt-4o',
        input: 'Hello, world!',
      })

      const response = await handleResponses(request, baseOptions)

      expect(response.status).toBe(200)
      expect(capturedBody).toMatchObject({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello, world!' }],
      })
    })

    it('응답을 ResponsesResponse 형식으로 변환한다', async () => {
      const request = createRequest({
        model: 'gpt-4o',
        input: 'Hello',
      })

      const response = await handleResponses(request, baseOptions)
      const body = (await response.json()) as {
        id: string
        object: string
        status: string
        output: Array<{ type: string; role: string; content: unknown[] }>
      }

      expect(body.id).toEqual(expect.any(String))
      expect(body.object).toBe('response')
      expect(body.status).toBe('completed')
      expect(Array.isArray(body.output)).toBe(true)
      expect(body.output).toHaveLength(1)
      expect(body.output[0]!.type).toBe('message')
      expect(body.output[0]!.role).toBe('assistant')
      expect(Array.isArray(body.output[0]!.content)).toBe(true)
    })

    it('복잡한 input 배열을 올바르게 변환한다', async () => {
      const request = createRequest({
        model: 'gpt-4o',
        input: [
          { type: 'message', role: 'user', content: 'First message' },
          { type: 'message', role: 'assistant', content: 'Response' },
          { type: 'message', role: 'user', content: 'Second message' },
        ],
      })

      await handleResponses(request, baseOptions)

      expect(capturedBody).toMatchObject({
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Response' },
          { role: 'user', content: 'Second message' },
        ],
      })
    })
  })

  describe('Model Mapping', () => {
    it('modelMappings가 적용된다', async () => {
      const mappings: AmpModelMapping[] = [{ from: 'claude-opus', to: 'gpt-4o' }]
      const request = createRequest({ model: 'claude-opus', input: 'Hi' })

      await handleResponses(request, { ...baseOptions, modelMappings: mappings })

      expect(capturedBody).toMatchObject({ model: 'gpt-4o' })
    })

    it('targetModel이 modelMappings를 덮어쓴다', async () => {
      const mappings: AmpModelMapping[] = [{ from: 'claude-opus', to: 'gpt-4o' }]
      const request = createRequest({ model: 'claude-opus', input: 'Hi' })

      await handleResponses(request, {
        ...baseOptions,
        modelMappings: mappings,
        targetModel: 'override-model',
      })

      expect(capturedBody).toMatchObject({ model: 'override-model' })
    })
  })

  describe('Provider Endpoints', () => {
    it('openai provider는 올바른 endpoint를 사용한다', async () => {
      const request = createRequest({ model: 'gpt-4o', input: 'Hi' })

      await handleResponses(request, { ...baseOptions, targetProvider: 'openai' })

      expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
      expect(capturedHeaders.Authorization).toBe('Bearer test-api-key')
    })

    it('anthropic provider는 올바른 headers를 설정한다', async () => {
      const request = createRequest({ model: 'claude-3', input: 'Hi' })

      await handleResponses(request, { ...baseOptions, targetProvider: 'anthropic' })

      expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages')
      expect(capturedHeaders['x-api-key']).toBe('test-api-key')
      expect(capturedHeaders['anthropic-version']).toBe('2023-06-01')
    })
  })

  describe('에러 처리', () => {
    it('알 수 없는 provider는 400 에러를 반환한다', async () => {
      const request = createRequest({ model: 'model', input: 'Hi' })

      const response = await handleResponses(request, {
        ...baseOptions,
        targetProvider: 'unknown',
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('Unknown provider')
    })

    it('네트워크 에러 시 502를 반환한다', async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          throw new Error('Network error')
        }),
        { preconnect: () => {} }
      ) as typeof fetch

      const request = createRequest({ model: 'gpt-4o', input: 'Hi' })
      const response = await handleResponses(request, baseOptions)

      expect(response.status).toBe(502)
    })
  })

  describe('Streaming 요청', () => {
    beforeEach(() => {
      globalThis.fetch = Object.assign(
        mock(async (_url: string, options?: { body?: string }) => {
          if (options?.body) {
            capturedBody = JSON.parse(options.body)
          }
          const chunks = [
            'data: {"id":"1","choices":[{"delta":{"role":"assistant"}}]}\n\n',
            'data: {"id":"1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
            'data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ]
          return new Response(new Blob(chunks).stream(), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }),
        { preconnect: () => {} }
      ) as typeof fetch
    })

    it('stream: true 요청 시 SSE 응답을 반환한다', async () => {
      const request = createRequest({
        model: 'gpt-4o',
        input: 'Hello',
        stream: true,
      })

      const response = await handleResponses(request, baseOptions)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(capturedBody).toMatchObject({ stream: true })
    })
  })
})
