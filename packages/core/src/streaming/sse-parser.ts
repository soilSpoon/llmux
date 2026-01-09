/**
 * SSE Parser
 *
 * Provides a generator-based parser for Server-Sent Events (SSE).
 * Supports standard SSE format (\n\n delimited) and line-delimited format (\n delimited).
 *
 * Uses eventsource-parser for standard SSE (robust handling of edge cases).
 * Custom parser for line-delimited format (used by some providers like Gemini).
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { StreamParserType } from '../providers/base'

/**
 * Represents a parsed SSE event with standard fields.
 *
 * @property data - The event data (required)
 * @property event - Optional event type (from "event:" field)
 * @property id - Optional event ID (from "id:" field)
 * @property retry - Optional reconnection time in ms (from "retry:" field)
 */
export interface SseEvent {
  data: string
  event?: string
  id?: string
  retry?: number
}

/**
 * Creates an async generator that yields SseEvents from a ReadableStreamDefaultReader
 * or any async iterable of strings/bytes.
 *
 * Supports two parsing modes:
 * - 'sse-standard': Standard SSE with events separated by blank lines (\n\n)
 *   Uses eventsource-parser for robust handling of multi-line data, comments, etc.
 * - 'sse-line-delimited': Each line is a separate event (used by some providers)
 *
 * @param reader - The source of chunks (string or Uint8Array)
 * @param parserType - The type of SSE parsing to apply ('sse-standard' | 'sse-line-delimited')
 * @yields SseEvent objects parsed from the stream
 *
 * @example
 * ```ts
 * const response = await fetch(url)
 * const reader = response.body?.getReader()
 * if (reader) {
 *   for await (const event of readSseEvents(reader, 'sse-standard')) {
 *     console.log(event.data)
 *   }
 * }
 * ```
 */
export async function* readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array | string> | AsyncIterable<Uint8Array | string>,
  parserType: StreamParserType = 'sse-standard'
): AsyncGenerator<SseEvent, void, unknown> {
  const decoder = new TextDecoder()
  const iterable = isAsyncIterable(reader) ? reader : streamToAsyncIterable(reader)

  if (parserType === 'sse-standard') {
    yield* readStandardSse(iterable, decoder)
  } else {
    yield* readLineDelimitedSse(iterable, decoder)
  }
}

/**
 * Parse standard SSE format using eventsource-parser.
 * Handles multi-line data, comments, retry fields, and event IDs correctly.
 */
async function* readStandardSse(
  iterable: AsyncIterable<Uint8Array | string>,
  decoder: TextDecoder
): AsyncGenerator<SseEvent, void, unknown> {
  const events: SseEvent[] = []
  let currentRetry: number | undefined

  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      events.push({
        data: event.data,
        event: event.event || undefined,
        id: event.id || undefined,
        retry: currentRetry,
      })
      currentRetry = undefined
    },
    onRetry: (milliseconds: number) => {
      currentRetry = milliseconds
    },
    onComment: (_comment: string) => {
      // SSE comments (lines starting with :) are intentionally ignored
      // They can be used as keep-alive pings
    },
  })

  for await (const chunk of iterable) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    parser.feed(text)

    while (events.length > 0) {
      const event = events.shift()
      if (event) yield event
    }
  }

  // Flush any remaining text (final decode without stream option)
  parser.feed(decoder.decode())

  while (events.length > 0) {
    const event = events.shift()
    if (event) yield event
  }
}

/**
 * Parse line-delimited SSE format (non-standard, used by some providers like Gemini).
 * Each line is treated as a separate event.
 */
async function* readLineDelimitedSse(
  iterable: AsyncIterable<Uint8Array | string>,
  decoder: TextDecoder
): AsyncGenerator<SseEvent, void, unknown> {
  let buffer = ''

  for await (const chunk of iterable) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    buffer += text

    const lines = buffer.split(/\n/)
    buffer = lines.pop() || ''

    for (const line of lines) {
      const event = parseSseLine(line)
      if (event) yield event
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const event = parseSseLine(buffer)
    if (event) yield event
  }
}

/**
 * Parse a single line in line-delimited SSE format.
 *
 * Handles:
 * - "data: {...}" format
 * - Raw JSON without prefix
 * - Comments (lines starting with :) are ignored
 */
function parseSseLine(line: string): SseEvent | null {
  const trimmed = line.trim()

  // Ignore empty lines
  if (!trimmed) return null

  // Ignore SSE comments (keep-alive pings)
  if (trimmed.startsWith(':')) return null

  // Standard data prefix
  if (trimmed.startsWith('data: ')) {
    const data = trimmed.slice(6)
    // Ignore [DONE] sentinel (common in OpenAI-style streams)
    if (data === '[DONE]') return null
    return { data }
  }

  // Some providers send raw JSON without prefix
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { data: trimmed }
  }

  // Ignore other non-data lines (event:, id:, retry: are not typically used in line-delimited)
  return null
}

/**
 * Convert a ReadableStreamDefaultReader to an AsyncIterable.
 */
function streamToAsyncIterable<T>(reader: ReadableStreamDefaultReader<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const { done, value } = await reader.read()
          if (done) return { done: true, value: undefined }
          return { done: false, value }
        },
      }
    },
  }
}

/**
 * Type guard for AsyncIterable.
 */
function isAsyncIterable<T>(obj: unknown): obj is AsyncIterable<T> {
  return obj != null && typeof (obj as AsyncIterable<T>)[Symbol.asyncIterator] === 'function'
}
