/**
 * Integration test simulating the actual Oracle/gpt-5.1 request that was failing
 * with: "Upstream model returned empty response (0 tokens)"
 */
import { describe, expect, it } from 'bun:test'
import * as OpenAIRequest from '../../src/formats/openai-chat/request'
import * as AnthropicTransform from '../../src/providers/anthropic/request'

describe('Oracle Request Integration - Empty Messages Fallback', () => {
  it('should handle actual Oracle request format with empty messages and input', () => {
    // This is the actual structure from the debug log:
    // originalInputLen:2, messagesLen:0
    // But transformed should extract the input array
    const oracleRequest = {
      model: 'gpt-5.1',
      messages: [] as any[],
      input: [
        {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You are the Oracle - an expert AI advisor...'
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Analyze this codebase...'
            }
          ]
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'find_thread',
            description: 'Find Amp threads'
          }
        }
      ],
      stream: true,
      store: false
    }

    // Step 1: Parse with OpenAI format
    const unifiedRequest = OpenAIRequest.parseRequest(oracleRequest as any)

    // Verify that input was used instead of empty messages
    expect(unifiedRequest.messages.length).toBeGreaterThan(0)
    
    // Verify system message was extracted
    expect(unifiedRequest.system).toContain('Oracle')
    
    // Verify user message is present
    const firstMsg = unifiedRequest.messages[0]
    expect(firstMsg).toBeDefined()
    expect(firstMsg?.role).toBe('user')
    expect((firstMsg?.parts.length) ?? 0).toBeGreaterThan(0)
    
    // Verify tools were parsed
    expect(unifiedRequest.tools).toBeDefined()
    expect(unifiedRequest.tools?.length).toBe(1)
    const tool = unifiedRequest.tools?.[0]
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('find_thread')
  })

  it('should preserve messages when provided instead of input', () => {
    const request = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'User message' }
      ]
    }

    const unified = OpenAIRequest.parseRequest(request as any)

    expect(unified.messages).toHaveLength(1) // system extracted
    expect(unified.system).toBe('System message')
    const firstPart = unified.messages[0]?.parts[0]
    expect(firstPart).toEqual({
      type: 'text',
      text: 'User message'
    })
  })

  it('should round-trip Oracle request through Anthropic format', () => {
    const oracleRequest = {
      model: 'gpt-5.1',
      messages: [] as any[],
      input: [
        {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You are helpful'
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Hello'
            }
          ]
        }
      ]
    }

    // Parse as OpenAI
    const unified = OpenAIRequest.parseRequest(oracleRequest as any)
    expect(unified.messages.length).toBeGreaterThan(0)

    // Transform to Anthropic format
    const anthropicRequest = AnthropicTransform.transform(unified, 'claude-opus-4-1')

    // Verify Anthropic format is valid
    expect(anthropicRequest.messages.length).toBeGreaterThan(0)
    expect(anthropicRequest.system).toBeDefined()
  })
})
