import { describe, expect, it } from 'bun:test'
import * as OpenAIRequestMod from '../../src/formats/openai-chat/request'

// Wrap to match test usage
const OpenAIRequest = {
  parse: OpenAIRequestMod.parseRequest
}

describe('OpenAI Request - Messages/Input Fallback', () => {
  describe('parse() - empty messages should fallback to input', () => {
    it('should use input field when messages is an empty array', () => {
      const request = {
        model: 'gpt-5.1',
        messages: [] as any[],
        input: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello, world!' }
        ]
      }

      const result = OpenAIRequest.parse(request as any)

      expect(result.messages).toHaveLength(1) // system is extracted, user remains
      const msg = result.messages[0]
      expect(msg).toBeDefined()
      expect(msg?.role).toBe('user')
      const firstPart = result.messages[0]?.parts[0]
      expect(firstPart).toEqual({ type: 'text', text: 'Hello, world!' })
      expect(result.system).toBe('You are a helpful assistant.')
    })

    it('should use messages field when it has content (even if input exists)', () => {
      const request = {
        model: 'gpt-5.1',
        messages: [
          { role: 'system', content: 'Messages system' },
          { role: 'user', content: 'Messages user' }
        ],
        input: [
          { role: 'system', content: 'Input system' },
          { role: 'user', content: 'Input user' }
        ]
      }

      const result = OpenAIRequest.parse(request as any)

      // Messages should take priority
      expect(result.messages).toHaveLength(1)
      const msgPart = result.messages[0]?.parts[0]
      expect(msgPart).toEqual({ type: 'text', text: 'Messages user' })
      expect(result.system).toBe('Messages system')
    })

    it('should handle Oracle-style request with empty messages and input array', () => {
      const request = {
        model: 'gpt-5.1',
        messages: [] as any[],
        input: [
          {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: 'Oracle system prompt...' }]
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Analyze this code' }]
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_code',
              description: 'Search code'
            }
          }
        ]
      }

      const result = OpenAIRequest.parse(request as any)

      expect(result.messages.length).toBeGreaterThan(0)
      expect(result.system).toBeTruthy()
      expect(result.tools).toHaveLength(1)
    })

    it('should use empty array when both messages and input are empty', () => {
      const request = {
        model: 'gpt-5.1',
        messages: [] as any[],
        input: [] as any[]
      }

      const result = OpenAIRequest.parse(request as any)

      expect(result.messages).toHaveLength(0)
      expect(result.system).toBeUndefined()
    })

    it('should prefer input over undefined messages', () => {
      const request = {
        model: 'gpt-5.1',
        input: [
          { role: 'user', content: 'Hello from input' }
        ]
      }

      const result = OpenAIRequest.parse(request as any)

      expect(result.messages).toHaveLength(1)
      const inputPart = result.messages[0]?.parts[0]
      expect(inputPart).toEqual({ type: 'text', text: 'Hello from input' })
    })
  })
})
