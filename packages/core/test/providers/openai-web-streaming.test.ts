/**
 * Tests for OpenAI Web (Responses API) streaming parser
 */
import { describe, expect, it } from 'bun:test'
import { parseStreamChunk } from '../../src/providers/openai-web/streaming'

describe('OpenAI Web Responses API Streaming', () => {
  describe('parseStreamChunk - response.output_text.delta', () => {
    it('should parse text delta events', () => {
      const chunk = `event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_123","delta":"Hello","output_index":0}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        type: 'content',
        blockIndex: 0,
        delta: {
          type: 'text',
          text: 'Hello',
        },
      })
    })
  })

  describe('parseStreamChunk - response.function_call_arguments.delta', () => {
    it('should parse function call arguments delta', () => {
      const chunk = `event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","delta":"{\\"pattern\\":","output_index":1,"call_id":"call_123","name":"Grep"}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        type: 'tool_call',
        blockIndex: 1,
        delta: {
          type: 'tool_call',
          partialJson: '{"pattern":',
        },
      })
    })
  })

  describe('parseStreamChunk - response.output_item.added', () => {
    it('should parse function_call item added event', () => {
      const chunk = `event: response.output_item.added
data: {"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","id":"fc_123","call_id":"call_456","name":"Read","arguments":""}}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        type: 'tool_call',
        blockIndex: 2,
        delta: {
          type: 'tool_call',
          toolCall: {
            id: 'call_456',
            name: 'Read',
          },
        },
      })
    })

    it('should return null for message item added event', () => {
      const chunk = `event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_123","role":"assistant","content":[]}}`

      const result = parseStreamChunk(chunk)
      expect(result).toBeNull()
    })
  })

  describe('parseStreamChunk - response.completed', () => {
    it('should extract content from completed response with message output', () => {
      const chunk = `event: response.completed
data: {"type":"response.completed","sequence_number":100,"response":{"id":"resp_123","status":"completed","output":[{"type":"message","id":"msg_123","role":"assistant","content":[{"type":"output_text","text":"This is the final response."}],"status":"completed"}],"usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150}}}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(Array.isArray(result)).toBe(true)

      const chunks = result as Array<{ type: string; delta?: { text?: string } }>
      expect(chunks.length).toBeGreaterThanOrEqual(2)

      const contentChunk = chunks.find(c => c.type === 'content')
      expect(contentChunk).toBeDefined()
      expect(contentChunk?.delta?.text).toBe('This is the final response.')

      const usageChunk = chunks.find(c => c.type === 'usage')
      expect(usageChunk).toBeDefined()

      const doneChunk = chunks.find(c => c.type === 'done')
      expect(doneChunk).toBeDefined()
    })

    it('should extract function calls from completed response', () => {
      const chunk = `event: response.completed
data: {"type":"response.completed","response":{"id":"resp_456","status":"completed","output":[{"type":"function_call","id":"fc_789","call_id":"call_abc","name":"glob","arguments":"{\\"filePattern\\":\\"**/*.ts\\"}"}]}}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(Array.isArray(result)).toBe(true)

      const chunks = result as Array<{
        type: string
        delta?: { toolCall?: { name?: string; arguments?: string } }
      }>

      const toolCallChunk = chunks.find(c => c.type === 'tool_call')
      expect(toolCallChunk).toBeDefined()
      expect(toolCallChunk?.delta?.toolCall?.name).toBe('glob')
      expect(toolCallChunk?.delta?.toolCall?.arguments).toBe('{"filePattern":"**/*.ts"}')
    })

    it('should extract reasoning/thinking summary from completed response', () => {
      const chunk = `event: response.completed
data: {"type":"response.completed","response":{"id":"resp_789","status":"completed","output":[{"type":"reasoning","id":"rs_123","summary":[{"type":"summary_text","text":"I analyzed the codebase structure..."}]}]}}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(Array.isArray(result)).toBe(true)

      const chunks = result as Array<{
        type: string
        delta?: { thinking?: { text?: string } }
      }>

      const thinkingChunk = chunks.find(c => c.type === 'thinking')
      expect(thinkingChunk).toBeDefined()
      expect(thinkingChunk?.delta?.thinking?.text).toBe('I analyzed the codebase structure...')
    })
  })

  describe('parseStreamChunk - edge cases', () => {
    it('should return null for response.created event', () => {
      const chunk = `event: response.created
data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_123","status":"in_progress"}}`

      const result = parseStreamChunk(chunk)
      expect(result).toBeNull()
    })

    it('should return null for response.in_progress event', () => {
      const chunk = `event: response.in_progress
data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_123","status":"in_progress"}}`

      const result = parseStreamChunk(chunk)
      expect(result).toBeNull()
    })

    it('should handle [DONE] signal', () => {
      const chunk = 'data: [DONE]'
      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        type: 'done',
        stopReason: 'end_turn',
      })
    })

    it('should return null for empty input', () => {
      expect(parseStreamChunk('')).toBeNull()
      expect(parseStreamChunk('   ')).toBeNull()
    })

    it('should return null for comments', () => {
      expect(parseStreamChunk(': ping')).toBeNull()
      expect(parseStreamChunk(': keep-alive')).toBeNull()
    })

    it('should handle response.failed event', () => {
      const chunk = `event: response.failed
data: {"type":"response.failed","response":{"id":"resp_fail","status":"failed"}}`

      const result = parseStreamChunk(chunk)

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        type: 'error',
      })
    })
  })
})
