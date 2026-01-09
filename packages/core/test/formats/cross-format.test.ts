import { describe, expect, it } from 'bun:test'
import { OpenAIChatFormat } from '../../src/formats/openai-chat'
import { AnthropicMessagesFormat } from '../../src/formats/anthropic-messages'
import type { FormatContext } from '../../src/formats/base'

describe('Cross-format transformation', () => {
  const openaiCtx: FormatContext = { provider: 'openai', model: 'gpt-4' }
  const anthropicCtx: FormatContext = { provider: 'anthropic', model: 'claude-3-opus-20240229' }

  it('OpenAI Chat → Anthropic → OpenAI Chat preserves content', () => {
    const openaiRequest = {
      model: 'gpt-4',
      // Anthropic requires max_tokens, so it gets added during transformation.
      // We include it here to verify stable round-trip.
      max_tokens: 4096,
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' }
      ]
    }

    // Parse from OpenAI
    const unified = OpenAIChatFormat.parseRequest(openaiRequest)

    // Build to Anthropic
    const anthropicRequest = AnthropicMessagesFormat.buildWireRequest(unified, anthropicCtx) as any

    // Verify Anthropic structure
    expect(anthropicRequest.system).toEqual([{ type: 'text', text: 'You are helpful.' }])
    expect(anthropicRequest.messages).toHaveLength(1)
    expect(anthropicRequest.messages[0].role).toBe('user')
    expect(anthropicRequest.messages[0].content).toEqual([{ type: 'text', text: 'Hello' }])
    expect(anthropicRequest.max_tokens).toBe(4096)

    // Parse from Anthropic back
    const unifiedAgain = AnthropicMessagesFormat.parseRequest(anthropicRequest)

    // Build back to OpenAI
    const openaiAgain = OpenAIChatFormat.buildWireRequest(unifiedAgain, openaiCtx)

    // Should match original
    expect(openaiAgain).toEqual(openaiRequest)
  })

  it('OpenAI Chat → Gemini → OpenAI Chat preserves content', () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' }
      ]
    }
    const geminiCtx: FormatContext = { provider: 'google', model: 'gemini-pro' }

    // Parse from OpenAI
    const unified = OpenAIChatFormat.parseRequest(openaiRequest)

    // Build to Gemini
    const geminiRequest = import.meta.require('../../src/formats/google-gemini').GoogleGeminiFormat.buildWireRequest(unified, geminiCtx)

    // Verify Gemini structure
    expect(geminiRequest.contents).toHaveLength(1)
    expect(geminiRequest.contents[0].role).toBe('user')
    expect(geminiRequest.contents[0].parts[0].text).toBe('Hello')
    expect(geminiRequest.systemInstruction).toBeDefined()
    expect(geminiRequest.systemInstruction.parts[0].text).toBe('You are helpful.')

    // Parse from Gemini back
    const unifiedAgain = import.meta.require('../../src/formats/google-gemini').GoogleGeminiFormat.parseRequest(geminiRequest)

    // Build back to OpenAI
    const openaiAgain = OpenAIChatFormat.buildWireRequest(unifiedAgain, openaiCtx)

    // Should match original
    expect(openaiAgain).toEqual(openaiRequest)
  })

  it('Anthropic → OpenAI Chat → Anthropic preserves content', () => {
    const anthropicRequest = {
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'You are helpful.' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
      ]
    }

    // Parse from Anthropic
    const unified = AnthropicMessagesFormat.parseRequest(anthropicRequest)

    // Build to OpenAI
    const openaiRequest = OpenAIChatFormat.buildWireRequest(unified, openaiCtx) as any

    // Verify OpenAI structure
    expect(openaiRequest.messages).toHaveLength(2)
    expect(openaiRequest.messages[0].role).toBe('system')
    expect(openaiRequest.messages[0].content).toBe('You are helpful.')
    expect(openaiRequest.messages[1].role).toBe('user')
    expect(openaiRequest.messages[1].content).toBe('Hello')
    expect(openaiRequest.max_tokens).toBe(1024)

    // Parse from OpenAI back
    const unifiedAgain = OpenAIChatFormat.parseRequest(openaiRequest)

    // Build back to Anthropic
    const anthropicAgain = AnthropicMessagesFormat.buildWireRequest(unifiedAgain, anthropicCtx)

    // Should match original
    expect(anthropicAgain).toEqual(anthropicRequest)
  })
})

