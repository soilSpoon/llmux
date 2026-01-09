import { describe, expect, it } from 'bun:test'
import { readSseEvents } from '../../src/streaming/sse-parser'

describe('readSseEvents', () => {
  describe('sse-standard', () => {
    it('parses standard SSE chunks', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('event: message\n')
          controller.enqueue('data: hello\n\n')
          controller.enqueue('data: world\n\n')
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
      for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'hello', event: 'message', id: undefined, retry: undefined },
        { data: 'world', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles multi-line data', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('data: line 1\n')
          controller.enqueue('data: line 2\n\n')
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
      for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'line 1\nline 2', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles split chunks correctly', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('data: hel')
          controller.enqueue('lo\n\n')
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
      for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'hello', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('ignores comments', async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(': keep-alive\n\n')
            controller.enqueue('data: real data\n\n')
            controller.close()
          },
        })
  
        const events: any[] = []
        // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
        for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
          events.push(event)
        }
  
        expect(events).toEqual([
          { data: 'real data', event: undefined, id: undefined, retry: undefined },
        ])
    })
  })

  describe('sse-line-delimited', () => {
    it('parses line-delimited SSE chunks', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('data: {"text": "hello"}\n')
          controller.enqueue('data: {"text": "world"}\n')
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
      for await (const event of readSseEvents(stream.getReader(), 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "hello"}' },
        { data: '{"text": "world"}' },
      ])
    })

    it('parses raw JSON lines without prefix', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('{"text": "hello"}\n')
          controller.enqueue('{"text": "world"}\n')
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
      for await (const event of readSseEvents(stream.getReader(), 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "hello"}' },
        { data: '{"text": "world"}' },
      ])
    })

    it('ignores empty lines', async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue('{"text": "hello"}\n\n')
            controller.enqueue('{"text": "world"}\n')
            controller.close()
          },
        })
  
        const events: any[] = []
        // @ts-ignore - Bun's ReadableStream reader is compatible at runtime
        for await (const event of readSseEvents(stream.getReader(), 'sse-line-delimited')) {
          events.push(event)
        }
  
        expect(events).toEqual([
            { data: '{"text": "hello"}' },
            { data: '{"text": "world"}' },
        ])
    })
  })
})
