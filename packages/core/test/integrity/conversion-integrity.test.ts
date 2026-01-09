
import { describe, it, expect } from 'bun:test'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'
import { GoogleGeminiFormat } from '../../src/formats/google-gemini'
import type { UnifiedRequest } from '../../src/types/unified'

describe('Conversion Integrity (Lossless Round-Trip)', () => {
  describe('Anthropic -> Unified -> Anthropic', () => {
    it('should preserve thinking signature and text exactly', () => {
      // 1. Raw Anthropic Request (Simulated)
      const rawAnthropicBody = {
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'I am thinking...',
                signature: 'sig_123456'
              },
              {
                type: 'text',
                text: 'Here is the answer.'
              }
            ]
          }
        ],
        model: 'claude-3-7-sonnet-20250219'
      }

      // 2. Parse to Unified
      const unified = AnthropicMessagesFormat.parseRequest(rawAnthropicBody)
      
      // Verify Unified state
      const assistantMsg = unified.messages[0]
      expect(assistantMsg).toBeDefined()
      if (assistantMsg && assistantMsg.parts.length > 0) {
          const part = assistantMsg.parts[0]
          expect(part).toBeDefined()
          if (part) {
            expect(part.type).toBe('thinking')
            expect(part.thinking?.text).toBe('I am thinking...')
            expect(part.thinking?.signature).toBe('sig_123456')
          }
      }

      // 3. Build back to Anthropic
      const built = AnthropicMessagesFormat.buildWireRequest(unified, { model: 'claude-3-7-sonnet-20250219', provider: 'anthropic' }) as Record<string, any>

      // 4. Verify Round-Trip
      if (built.messages && built.messages.length > 0) {
        const builtContent = built.messages[0].content
        expect(builtContent[0].type).toBe('thinking')
        expect(builtContent[0].thinking).toBe('I am thinking...')
        expect(builtContent[0].signature).toBe('sig_123456')
      } else {
        throw new Error('Anthropic built messages missing')
      }
    })

    it('should preserve cache_control metadata', () => {
      const rawAnthropicBody = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Huge context...',
                cache_control: { type: 'ephemeral' }
              }
            ]
          }
        ],
        system: [
          {
            type: 'text',
            text: 'System prompt',
            cache_control: { type: 'extended' } // checking non-standard type preservation
          }
        ],
        model: 'claude-3-5-sonnet-20241022'
      }

      const unified = AnthropicMessagesFormat.parseRequest(rawAnthropicBody)
      
      // Verify Unified
      expect(unified.messages[0]?.parts[0]?.cacheControl).toEqual({ type: 'ephemeral' })
      // System blocks should be parsed
      expect(unified.systemBlocks).toBeDefined()
      if (unified.systemBlocks && unified.systemBlocks.length > 0) {
          const sysBlock = unified.systemBlocks[0]
          expect(sysBlock?.cacheControl).toEqual({ type: 'extended' })
      }

      // Build back
      const built = AnthropicMessagesFormat.buildWireRequest(unified, { model: 'claude-3-5-sonnet-20241022', provider: 'anthropic' }) as Record<string, any>

      // Verify
      if (built.messages && built.messages[0]) {
        const msgContent = built.messages[0].content
        expect(msgContent[0].cache_control).toEqual({ type: 'ephemeral' })
      } else {
        throw new Error('Anthropic messages missing')
      }
      
      if (built.system && built.system[0]) {
        const sysContent = built.system
        expect(sysContent[0].cache_control).toEqual({ type: 'extended' })
      } else {
         throw new Error('Anthropic system missing')
      }
    })
  })

  describe('Gemini -> Unified -> Gemini', () => {
    it('should preserve tool call IDs (Gemini 2.5+)', () => {
      // 1. Raw Gemini Request (functionCall with ID)
      const rawGeminiBody = {
        contents: [
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call_abc123',
                  name: 'get_weather',
                  args: { location: 'Seoul' }
                }
              }
            ]
          }
        ]
      }

      // 2. Parse
      const unified = GoogleGeminiFormat.parseRequest(rawGeminiBody)
      
      // Verify
      const part = unified.messages[0]?.parts[0]
      expect(part?.type).toBe('tool_call')
      expect(part?.toolCall?.id).toBe('call_abc123')

      // 3. Build back
      const built = GoogleGeminiFormat.buildWireRequest(unified, { model: 'gemini-2.5-flash', provider: 'antigravity' }) as Record<string, any>

      // 4. Verify
      expect(built.contents).toBeDefined()
      if (built.contents && built.contents.length > 0 && built.contents[0].parts.length > 0) {
        const builtPart = built.contents[0].parts[0]
        expect(builtPart.functionCall).toBeDefined()
        
        // Expectation: ID MUST be preserved for modern Gemini models
        // Check if the current implementation supports it
        expect(builtPart.functionCall).toHaveProperty('id')
        if (builtPart.functionCall && 'id' in builtPart.functionCall) {
            expect(builtPart.functionCall.id).toBe('call_abc123')
        }
      } else {
        throw new Error('Gemini content structure mismatch')
      }
    })

    it('should normalize and restore system instructions', () => {
      const rawGeminiBody = {
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        systemInstruction: {
          parts: [{ text: 'You are a helpful assistant.' }]
        }
      }

      const unified = GoogleGeminiFormat.parseRequest(rawGeminiBody)
      
      expect(unified.system).toBe('You are a helpful assistant.')

      const built = GoogleGeminiFormat.buildWireRequest(unified, { model: 'gemini-1.5-flash', provider: 'antigravity' }) as Record<string, any>

      expect(built.systemInstruction).toBeDefined()
      if (built.systemInstruction && built.systemInstruction.parts && built.systemInstruction.parts[0]) {
        expect(built.systemInstruction.parts[0].text).toBe('You are a helpful assistant.')
      }
    })
  })

  describe('Cross-Provider Consistency', () => {
    it('Anthropic Thinking -> Gemini (should be hidden or text)', () => {
        const unified: UnifiedRequest = {
            messages: [{
                role: 'assistant',
                parts: [{
                    type: 'thinking',
                    thinking: { text: 'Hidden thought', signature: 'sig' }
                }]
            }]
        }

        const gemini = GoogleGeminiFormat.buildWireRequest(unified, { model: 'gemini-1.5-pro', provider: 'antigravity' }) as Record<string, any>
        
        // Gemini doesn't have native thinking blocks in API input yet (as of standard SDK)
        // Usually converted to text or ignored?
        // Let's check what our implementation does. It should ideally preserve it as text with some marker?
        // Or if we implemented `thought: true` support.
        
        if (gemini.contents && gemini.contents[0].parts && gemini.contents[0].parts[0]) {
            const part = gemini.contents[0].parts[0]
            // Expectation: It should probably be text content so it's not lost
            expect(part.text).toContain('Hidden thought')
        }
    })
  })
})
