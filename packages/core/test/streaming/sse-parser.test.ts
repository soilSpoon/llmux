import { describe, expect, it } from 'bun:test'
import type { SseEvent } from '../../src/streaming/sse-parser'
import { readSseEvents } from '../../src/streaming/sse-parser'

async function* createSseIterable(
  chunks: (string | Uint8Array)[]
): AsyncGenerator<string | Uint8Array> {
  for (const chunk of chunks) {
    yield chunk
  }
}

describe('readSseEvents', () => {
  describe('sse-standard', () => {
    it('parses standard SSE chunks', async () => {
      const iterable = createSseIterable([
        'event: message\n',
        'data: hello\n\n',
        'data: world\n\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'hello', event: 'message', id: undefined, retry: undefined },
        { data: 'world', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles multi-line data', async () => {
      const iterable = createSseIterable([
        'data: line 1\n',
        'data: line 2\n\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'line 1\nline 2', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles split chunks correctly', async () => {
      const iterable = createSseIterable([
        'data: hel',
        'lo\n\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'hello', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('ignores comments', async () => {
      const iterable = createSseIterable([
        ': keep-alive\n\n',
        'data: real data\n\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'real data', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles multibyte characters split across chunks', async () => {
      const char1 = new Uint8Array([0xEC, 0x95, 0x88])
      const char2 = new Uint8Array([0xEB, 0x85, 0x95])
      
      const iterable = createSseIterable([
        new TextEncoder().encode('data: '),
        char1,
        char2.slice(0, 1),
        char2.slice(1),
        new TextEncoder().encode('\n\n'),
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '안녕', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles multibyte characters split across three chunks', async () => {
      const char = new Uint8Array([0xF0, 0x9F, 0x91, 0x8D])
      
      const iterable = createSseIterable([
        new TextEncoder().encode('data: '),
        char.slice(0, 1),
        char.slice(1, 2),
        char.slice(2),
        new TextEncoder().encode('\n\n'),
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '👍', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles complex multibyte splitting mixed with ASCII', async () => {
      const han = [0xED, 0x95, 0x9C] as const
      const geul = [0xEA, 0xB8, 0x80] as const
      const rocket = [0xF0, 0x9F, 0x9A, 0x80] as const

      const iterable = createSseIterable([
        new TextEncoder().encode('data: A'),
        new Uint8Array([han[0]]),
        new Uint8Array([han[1], han[2], geul[0]]),
        new Uint8Array([geul[1]]),
        new Uint8Array([geul[2], rocket[0], rocket[1]]),
        new Uint8Array([rocket[2], rocket[3]]),
        new TextEncoder().encode('Z\n\n'),
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'A한글🚀Z', event: undefined, id: undefined, retry: undefined },
      ])
    })
  })

  describe('sse-line-delimited', () => {
    it('parses line-delimited SSE chunks', async () => {
      const iterable = createSseIterable([
        'data: {"text": "hello"}\n',
        'data: {"text": "world"}\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "hello"}' },
        { data: '{"text": "world"}' },
      ])
    })

    it('parses raw JSON lines without prefix', async () => {
      const iterable = createSseIterable([
        '{"text": "hello"}\n',
        '{"text": "world"}\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "hello"}' },
        { data: '{"text": "world"}' },
      ])
    })

    it('ignores empty lines', async () => {
      const iterable = createSseIterable([
        '{"text": "hello"}\n\n',
        '{"text": "world"}\n',
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "hello"}' },
        { data: '{"text": "world"}' },
      ])
    })

    it('handles multibyte characters split across chunks (line-delimited)', async () => {
      const char1 = new Uint8Array([0xEC, 0x95, 0x88])
      const char2 = new Uint8Array([0xEB, 0x85, 0x95])
      
      const iterable = createSseIterable([
        new TextEncoder().encode('{"text": "'),
        char1,
        char2.slice(0, 1),
        char2.slice(1),
        new TextEncoder().encode('"}\n'),
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "안녕"}' },
      ])
    })

    it('handles multibyte characters split across multiple chunks (line-delimited)', async () => {
      const char = new Uint8Array([0xF0, 0x9F, 0x8C, 0x8D])
      
      const iterable = createSseIterable([
        new TextEncoder().encode('{"text": "'),
        char.slice(0, 1),
        char.slice(1, 3),
        char.slice(3),
        new TextEncoder().encode('"}\n'),
      ])

      const events: SseEvent[] = []
      for await (const event of readSseEvents(iterable, 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "🌍"}' },
      ])
    })
  })
})
