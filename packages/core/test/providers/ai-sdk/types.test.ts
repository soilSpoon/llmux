import { describe, expect, it } from 'bun:test'
import {
  isAiSdkCallOptions,
  isTextPart,
  isFilePart,
  isToolCallPart,
  isReasoningPart,
  isToolResultPart,
  isTextContent,
  isReasoningContent,
  isFileContent,
  isToolCallContent,
  isFunctionTool,
} from '../../../src/providers/ai-sdk/types'

describe('AI SDK Types', () => {
  describe('isAiSdkCallOptions', () => {
    it('returns true for valid call options', () => {
      const options = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      }
      expect(isAiSdkCallOptions(options)).toBe(true)
    })

    it('returns false for non-object', () => {
      expect(isAiSdkCallOptions(null)).toBe(false)
      expect(isAiSdkCallOptions(undefined)).toBe(false)
      expect(isAiSdkCallOptions('string')).toBe(false)
    })

    it('returns false for missing prompt', () => {
      expect(isAiSdkCallOptions({})).toBe(false)
    })

    it('returns false for non-array prompt', () => {
      expect(isAiSdkCallOptions({ prompt: 'string' })).toBe(false)
    })
  })

  describe('isTextPart', () => {
    it('returns true for text part', () => {
      expect(isTextPart({ type: 'text', text: 'Hello' })).toBe(true)
    })

    it('returns false for other types', () => {
      expect(isTextPart({ type: 'file' })).toBe(false)
      expect(isTextPart(null)).toBe(false)
    })
  })

  describe('isFilePart', () => {
    it('returns true for file part', () => {
      expect(isFilePart({ type: 'file', mediaType: 'image/png', data: 'base64data' })).toBe(true)
    })

    it('returns false for other types', () => {
      expect(isFilePart({ type: 'text' })).toBe(false)
    })
  })

  describe('isToolCallPart', () => {
    it('returns true for tool-call part', () => {
      expect(isToolCallPart({ type: 'tool-call', toolCallId: 'id', toolName: 'name', input: {} })).toBe(true)
    })

    it('returns false for other types', () => {
      expect(isToolCallPart({ type: 'text' })).toBe(false)
    })
  })

  describe('isReasoningPart', () => {
    it('returns true for reasoning part', () => {
      expect(isReasoningPart({ type: 'reasoning', text: 'thinking...' })).toBe(true)
    })

    it('returns false for other types', () => {
      expect(isReasoningPart({ type: 'text' })).toBe(false)
    })
  })

  describe('isToolResultPart', () => {
    it('returns true for tool-result part', () => {
      expect(isToolResultPart({ type: 'tool-result', toolCallId: 'id', result: 'result' })).toBe(true)
    })

    it('returns false for other types', () => {
      expect(isToolResultPart({ type: 'text' })).toBe(false)
    })
  })

  describe('isTextContent', () => {
    it('returns true for text content', () => {
      expect(isTextContent({ type: 'text', text: 'Hello' })).toBe(true)
    })

    it('returns false for other content types', () => {
      expect(isTextContent({ type: 'reasoning', text: 'thinking' })).toBe(false)
    })
  })

  describe('isReasoningContent', () => {
    it('returns true for reasoning content', () => {
      expect(isReasoningContent({ type: 'reasoning', text: 'thinking' })).toBe(true)
    })

    it('returns false for other content types', () => {
      expect(isTextContent({ type: 'text', text: 'hello' })).toBe(true)
    })
  })

  describe('isFileContent', () => {
    it('returns true for file content', () => {
      expect(isFileContent({ type: 'file', mediaType: 'image/png', data: 'base64' })).toBe(true)
    })

    it('returns false for other content types', () => {
      expect(isFileContent({ type: 'text', text: 'hello' })).toBe(false)
    })
  })

  describe('isToolCallContent', () => {
    it('returns true for tool-call content', () => {
      expect(isToolCallContent({ type: 'tool-call', toolCallId: 'id', toolName: 'name', input: '{}' })).toBe(true)
    })

    it('returns false for other content types', () => {
      expect(isToolCallContent({ type: 'text', text: 'hello' })).toBe(false)
    })
  })

  describe('isFunctionTool', () => {
    it('returns true for function tool', () => {
      expect(isFunctionTool({ type: 'function', name: 'tool', inputSchema: { type: 'object' } })).toBe(true)
    })

    it('returns false for other types', () => {
      expect(isFunctionTool({ type: 'other' })).toBe(false)
      expect(isFunctionTool(null)).toBe(false)
    })
  })
})
