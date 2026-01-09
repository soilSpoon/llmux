/**
 * OpenAI Responses Output Index Tests
 *
 * TDD: Verify that output_index is preserved correctly through transformation,
 * preventing "missing output at index N" errors on the client.
 *
 * Problem: Upstream sends reasoning item at output_index 0, message at output_index 1.
 * Our transformation was dropping the reasoning item, causing the client to see
 * output_index 1 without ever seeing output_index 0.
 */

import { describe, it, expect } from 'bun:test'
import { parseStreamChunk } from '../../src/formats/openai-responses/streaming'
import { OpenAIResponsesStreamingBuilder } from '../../src/formats/openai-responses/streaming-builder'

describe('OpenAI Responses Output Index Preservation', () => {
  describe('parseStreamChunk - reasoning item handling', () => {
    it('should parse response.output_item.added for reasoning type', () => {
      const sseChunk = `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"rs_123","type":"reasoning","summary":[]},"output_index":0,"sequence_number":2}`

      const result = parseStreamChunk(sseChunk)

      expect(result).not.toBeNull()
      // Should produce a thinking-start or similar chunk to preserve the item
      if (Array.isArray(result)) {
        expect(result.length).toBeGreaterThan(0)
        expect(result[0]?.blockIndex).toBe(0)
      } else if (result) {
        expect(result.blockIndex).toBe(0)
      }
    })

    it('should parse response.output_item.done for reasoning type with empty summary', () => {
      const sseChunk = `event: response.output_item.done
data: {"type":"response.output_item.done","item":{"id":"rs_123","type":"reasoning","summary":[]},"output_index":0,"sequence_number":3}`

      const result = parseStreamChunk(sseChunk)

      // Should produce a thinking-end or block_stop chunk
      expect(result).not.toBeNull()
      if (Array.isArray(result)) {
        expect(result[0]?.blockIndex).toBe(0)
      } else if (result) {
        expect(result.blockIndex).toBe(0)
      }
    })

    it('should parse response.output_item.added for message type', () => {
      const sseChunk = `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"msg_123","type":"message","status":"in_progress","content":[],"role":"assistant"},"output_index":1,"sequence_number":4}`

      const result = parseStreamChunk(sseChunk)

      expect(result).not.toBeNull()
      if (Array.isArray(result)) {
        expect(result[0]?.blockIndex).toBe(1)
      } else if (result) {
        expect(result.blockIndex).toBe(1)
      }
    })
  })

  describe('Roundtrip: parseStreamChunk -> StreamingBuilder', () => {
    it('should preserve output_index sequence through roundtrip', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      // Simulate upstream sequence: reasoning at 0, message at 1
      const upstreamEvents = [
        `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"rs_123","type":"reasoning","summary":[]},"output_index":0,"sequence_number":2}`,
        `event: response.output_item.done
data: {"type":"response.output_item.done","item":{"id":"rs_123","type":"reasoning","summary":[]},"output_index":0,"sequence_number":3}`,
        `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"msg_123","type":"message","status":"in_progress","content":[],"role":"assistant"},"output_index":1,"sequence_number":4}`,
        `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"Hello","output_index":1,"item_id":"msg_123","content_index":0,"sequence_number":5}`,
      ]

      const allOutputEvents: string[] = []

      for (const sseChunk of upstreamEvents) {
        const parsed = parseStreamChunk(sseChunk)
        if (parsed) {
          const chunks = Array.isArray(parsed) ? parsed : [parsed]
          for (const chunk of chunks) {
            const outputEvents = builder.build(chunk)
            allOutputEvents.push(...outputEvents)
          }
        }
      }

      // Find output_item.added events and check their output_index values
      const itemAddedEvents = allOutputEvents
        .filter((e) => e.includes('response.output_item.added'))
        .map((e) => {
          const dataLine = e.split('\n').find((l) => l.startsWith('data:'))
          return JSON.parse(dataLine?.replace('data: ', '') ?? '{}')
        })

      // Should have at least two items: one at index 0, one at index 1
      const outputIndices = itemAddedEvents.map((e) => e.output_index).sort()

      // Critical: output_index 0 must exist before output_index 1
      expect(outputIndices).toContain(0)
      expect(outputIndices).toContain(1)
    })
  })

  describe('Empty reasoning handling', () => {
    it('should not drop reasoning items even when summary is empty', () => {
      const sseChunk = `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"rs_empty","type":"reasoning","summary":[]},"output_index":0,"sequence_number":2}`

      const result = parseStreamChunk(sseChunk)

      // Must not return null - empty reasoning should still be tracked
      expect(result).not.toBeNull()
    })
  })
})
