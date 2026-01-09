/**
 * Tests for functionCall thought_signature propagation
 *
 * Issue: gemini-cli API requires thought_signature on functionCall parts
 * when using thinking mode, but when converting from Anthropic format
 * (which doesn't have signatures on tool_use blocks), the signature is missing.
 */

import { describe, test, expect } from 'bun:test'
import {
  ensureThinkingSignatures,
  type UnifiedRequestBody,
} from '../signature-integration'

describe('functionCall thought_signature propagation', () => {
  const sessionKey = 'test-session-key'

  describe('normalizeGeminiContents', () => {
    test('should add skip_thought_signature_validator to functionCall without signature', () => {
      // Simulate a request converted from Anthropic format where
      // assistant message has thinking + functionCall, but no signature on functionCall
      const requestBody: UnifiedRequestBody = {
        request: {
          contents: [
            {
              role: 'user',
              parts: [{ text: 'Hello' }],
            },
            {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'Let me think about this...',
                  thought_signature: 'valid_signature_50chars_at_least_1234567890123456789',
                },
                {
                  functionCall: {
                    name: 'oracle',
                    args: { task: 'analyze project' },
                    id: 'call_123',
                  },
                  // No thought_signature - this is the bug!
                },
              ],
            },
          ],
        },
      }

      ensureThinkingSignatures(requestBody, sessionKey, 'gemini-3-pro-preview')

      const contents = requestBody.request?.contents
      expect(contents).toBeDefined()
      expect(contents).toHaveLength(2)

      const modelContent = contents?.[1]
      expect(modelContent).toBeDefined()
      expect(modelContent?.parts).toHaveLength(2)

      // The functionCall part should now have thought_signature
      const functionCallPart = modelContent?.parts?.[1]
      expect(functionCallPart?.functionCall).toBeDefined()
      expect(functionCallPart?.thought_signature).toBeDefined()
      // Should use the signature from thinking block, or skip_thought_signature_validator
      expect(typeof functionCallPart?.thought_signature).toBe('string')
      expect(functionCallPart?.thought_signature?.length).toBeGreaterThan(0)
    })

    test('should propagate thought_signature from preceding thinking block to functionCall', () => {
      const validSignature = 'CiQBjz1rX+CtwbaZuxZfw2s2CKQAPkyGcGVcIIkCUw4IgJrPeMMKbQGPPWtf'
      
      const requestBody: UnifiedRequestBody = {
        request: {
          contents: [
            {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'Thinking...',
                  thought_signature: validSignature,
                },
                {
                  functionCall: {
                    name: 'test_tool',
                    args: {},
                    id: 'call_abc',
                  },
                  // No signature yet
                },
              ],
            },
          ],
        },
      }

      ensureThinkingSignatures(requestBody, sessionKey, 'gemini-3-flash-preview')

      const functionCallPart = requestBody.request?.contents?.[0]?.parts?.[1]
      expect(functionCallPart?.functionCall).toBeDefined()
      // Should propagate the signature from preceding thinking block
      expect(functionCallPart?.thought_signature).toBe(validSignature)
    })

    test('should use skip_thought_signature_validator when no preceding signature available', () => {
      // Case where there's no thinking block (e.g., restored from history without signature)
      const requestBody: UnifiedRequestBody = {
        request: {
          contents: [
            {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'danger_tool',
                    args: {},
                    id: 'call_no_sig',
                  },
                },
              ],
            },
          ],
        },
      }

      ensureThinkingSignatures(requestBody, sessionKey, 'gemini-3-pro-preview')

      const functionCallPart = requestBody.request?.contents?.[0]?.parts?.[0]
      expect(functionCallPart?.functionCall).toBeDefined()
      expect(functionCallPart?.thought_signature).toBe('skip_thought_signature_validator')
    })

    test('should handle multiple functionCalls in same message', () => {
      const validSignature = 'long_valid_signature_that_is_at_least_50_characters_for_testing'
      
      const requestBody: UnifiedRequestBody = {
        request: {
          contents: [
            {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'Multiple tools needed...',
                  thought_signature: validSignature,
                },
                {
                  functionCall: { name: 'tool1', args: {}, id: 'call_1' },
                },
                {
                  functionCall: { name: 'tool2', args: {}, id: 'call_2' },
                },
              ],
            },
          ],
        },
      }

      ensureThinkingSignatures(requestBody, sessionKey, 'gemini-3-pro-preview')

      const parts = requestBody.request?.contents?.[0]?.parts
      expect(parts?.[1]?.thought_signature).toBe(validSignature)
      expect(parts?.[2]?.thought_signature).toBe(validSignature)
    })

    test('should preserve existing thought_signature on functionCall', () => {
      const existingSignature = 'already_has_signature_50chars_or_more_for_validation_test'
      
      const requestBody: UnifiedRequestBody = {
        request: {
          contents: [
            {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'tool', args: {}, id: 'call_x' },
                  thought_signature: existingSignature, // Already has signature
                },
              ],
            },
          ],
        },
      }

      ensureThinkingSignatures(requestBody, sessionKey, 'gemini-3-pro-preview')

      const functionCallPart = requestBody.request?.contents?.[0]?.parts?.[0]
      // Should preserve existing signature, not overwrite
      expect(functionCallPart?.thought_signature).toBe(existingSignature)
    })
  })
})
