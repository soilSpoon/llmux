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

    it('handles multibyte characters split across chunks', async () => {
      // "안녕" in UTF-8: 
      // 안: EC 95 88
      // 녕: EB 85 95
      const char1 = new Uint8Array([0xEC, 0x95, 0x88])
      const char2 = new Uint8Array([0xEB, 0x85, 0x95])
      
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: '))
          controller.enqueue(char1)
          // Split char2 (녕) between 0xEB and 0x85 0x95
          controller.enqueue(char2.slice(0, 1)) 
          controller.enqueue(char2.slice(1))
          controller.enqueue(new TextEncoder().encode('\n\n'))
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore
      for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '안녕', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles multibyte characters split across three chunks', async () => {
      // "👍" (Thumbs Up) in UTF-8: F0 9F 91 8D
      const char = new Uint8Array([0xF0, 0x9F, 0x91, 0x8D])
      
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: '))
          controller.enqueue(char.slice(0, 1)) // F0
          controller.enqueue(char.slice(1, 2)) // 9F
          controller.enqueue(char.slice(2))    // 91 8D
          controller.enqueue(new TextEncoder().encode('\n\n'))
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore
      for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '👍', event: undefined, id: undefined, retry: undefined },
      ])
    })

    it('handles complex multibyte splitting mixed with ASCII', async () => {
      // "한글🚀" 
      // 한: EC 95 88 (Note: The previous test used EC 95 88 for '안', '한' is ED 95 9C)
      // Actually let's use:
      // 한 (ED 95 9C)
      // 글 (EA B8 80)
      // 🚀 (F0 9F 9A 80)
      const han = [0xED, 0x95, 0x9C] as const
      const geul = [0xEA, 0xB8, 0x80] as const
      const rocket = [0xF0, 0x9F, 0x9A, 0x80] as const

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: A'))
          controller.enqueue(new Uint8Array([han[0]]))
          controller.enqueue(new Uint8Array([han[1], han[2], geul[0]]))
          controller.enqueue(new Uint8Array([geul[1]]))
          controller.enqueue(new Uint8Array([geul[2], rocket[0], rocket[1]]))
          controller.enqueue(new Uint8Array([rocket[2], rocket[3]]))
          controller.enqueue(new TextEncoder().encode('Z\n\n'))
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore
      for await (const event of readSseEvents(stream.getReader(), 'sse-standard')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: 'A한글🚀Z', event: undefined, id: undefined, retry: undefined },
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

    it('handles multibyte characters split across chunks (line-delimited)', async () => {
      // "안녕" in UTF-8: 
      // 안: EC 95 88
      // 녕: EB 85 95
      const char1 = new Uint8Array([0xEC, 0x95, 0x88])
      const char2 = new Uint8Array([0xEB, 0x85, 0x95])
      
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"text": "'))
          controller.enqueue(char1)
          // Split char2 (녕) between 0xEB and 0x85 0x95
          controller.enqueue(char2.slice(0, 1)) 
          controller.enqueue(char2.slice(1))
          controller.enqueue(new TextEncoder().encode('"}\n'))
          controller.close()
        },
      })

      const events: any[] = []
      // @ts-ignore
      for await (const event of readSseEvents(stream.getReader(), 'sse-line-delimited')) {
        events.push(event)
      }

      expect(events).toEqual([
        { data: '{"text": "안녕"}' },
      ])
    })

    it('handles multibyte characters split across multiple chunks (line-delimited)', async () => {
        // "🌍" (Earth Globe Europe-Africa) in UTF-8: F0 9F 8C 8D
        const char = new Uint8Array([0xF0, 0x9F, 0x8C, 0x8D])
        
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"text": "'))
            controller.enqueue(char.slice(0, 1)) // F0
            controller.enqueue(char.slice(1, 3)) // 9F 8C
            controller.enqueue(char.slice(3))    // 8D
            controller.enqueue(new TextEncoder().encode('"}\n'))
            controller.close()
          },
        })
  
        const events: any[] = []
        // @ts-ignore
        for await (const event of readSseEvents(stream.getReader(), 'sse-line-delimited')) {
          events.push(event)
        }
  
        expect(events).toEqual([
          { data: '{"text": "🌍"}' },
        ])
      })
  })
})
