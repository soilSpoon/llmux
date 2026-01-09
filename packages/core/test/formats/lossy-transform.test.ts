import { describe, expect, it } from 'bun:test'
import { OpenAIChatFormat } from '../../src/formats/openai-chat'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'
import type { FormatContext } from '../../src/formats/base'

describe('Lossy Transformations', () => {
  const openaiCtx: FormatContext = { provider: 'openai', model: 'gpt-4' }

  it('should strip cache_control when converting Anthropic to OpenAI', () => {
    const anthropicRequest = {
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [
        { 
          role: 'user', 
          content: [
            { 
              type: 'text', 
              text: 'Heavy context', 
              cache_control: { type: 'ephemeral' } 
            }
          ] 
        }
      ]
    }

    // Parse from Anthropic
    const unified = AnthropicMessagesFormat.parseRequest(anthropicRequest)

    // Verify unified has cacheControl
    expect(unified.messages[0]).toBeDefined()
    expect(unified.messages[0]?.parts[0]).toBeDefined()
    expect(unified.messages[0]?.parts[0]?.cacheControl).toEqual({ type: 'ephemeral' })

    // Build to OpenAI
    const openaiRequest = OpenAIChatFormat.buildWireRequest(unified, openaiCtx) as Record<string, unknown>

    // Verify OpenAI request does not have cache_control info
    expect(openaiRequest.messages).toBeDefined()
    const messages = openaiRequest.messages as Array<{ content?: string }>
    expect(messages[0]?.content).toBe('Heavy context')
    // Ensure no extra fields leaked
    expect(JSON.stringify(openaiRequest)).not.toContain('cache_control')
    expect(JSON.stringify(openaiRequest)).not.toContain('ephemeral')
  })
})

