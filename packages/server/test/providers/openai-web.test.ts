import { describe, expect, test } from 'bun:test'
import { buildCodexBody, transformContentPartType, transformMessagesForCodex } from '../../src/providers/openai-web'

describe('OpenAI Web transformContentPartType', () => {
  test('should transform text to input_text for user role', () => {
    const part = { type: 'text', text: 'Hello' }
    const result = transformContentPartType(part, 'user')
    expect(result).toEqual({ type: 'input_text', text: 'Hello' })
  })

  test('should transform text to output_text for assistant role', () => {
    const part = { type: 'text', text: 'Hello' }
    const result = transformContentPartType(part, 'assistant')
    expect(result).toEqual({ type: 'output_text', text: 'Hello' })
  })

  test('should transform input_text based on role', () => {
    const part = { type: 'input_text', text: 'Hello' }
    expect(transformContentPartType(part, 'user')).toEqual({ type: 'input_text', text: 'Hello' })
    expect(transformContentPartType(part, 'assistant')).toEqual({ type: 'output_text', text: 'Hello' })
  })

  test('should remove cache_control from text parts', () => {
    const part = { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } }
    const result = transformContentPartType(part, 'user')
    expect(result).toEqual({ type: 'input_text', text: 'Hello' })
    expect(result).not.toHaveProperty('cache_control')
  })

  test('should remove cache_control from non-text parts', () => {
    const part = { type: 'input_image', image_url: 'http://example.com/img.png', cache_control: { type: 'ephemeral' } }
    const result = transformContentPartType(part, 'user')
    expect(result).toEqual({ type: 'input_image', image_url: 'http://example.com/img.png' })
  })

  test('should preserve non-text types unchanged except cache_control removal', () => {
    const part = { type: 'input_image', image_url: 'http://example.com/img.png' }
    const result = transformContentPartType(part, 'user')
    expect(result).toEqual({ type: 'input_image', image_url: 'http://example.com/img.png' })
  })
})

describe('OpenAI Web transformMessagesForCodex', () => {
  describe('content type transformation', () => {
    test('should transform text type to input_text for user messages', () => {
      const messages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ]

      const result = transformMessagesForCodex(messages)

      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ])
    })

    test('should transform text type to output_text for assistant messages', () => {
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi there' }],
        },
      ]

      const result = transformMessagesForCodex(messages)

      expect(result).toEqual([
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hi there' }],
        },
      ])
    })

    test('should remove cache_control from content parts', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } },
          ],
        },
      ]

      const result = transformMessagesForCodex(messages)

      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ])
    })

    test('should convert string content to array with input_text', () => {
      const messages = [
        {
          role: 'user',
          content: 'Hello world',
        },
      ]

      const result = transformMessagesForCodex(messages)

      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello world' }],
        },
      ])
    })

    test('should handle multiple content parts with mixed types', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'Second' },
            { type: 'input_image', image_url: 'http://example.com/image.png' },
          ],
        },
      ]

      const result = transformMessagesForCodex(messages)

      expect(result).toEqual([
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'First' },
            { type: 'input_text', text: 'Second' },
            { type: 'input_image', image_url: 'http://example.com/image.png' },
          ],
        },
      ])
    })
  })
})

describe('OpenAI Web buildCodexBody', () => {
  describe('instructions handling', () => {
    test('should NOT use systemInstructions that are too short (suspected placeholder)', async () => {
      // Simulates when a client sends "Codex test" or similar short placeholder
      const shortInstructions = 'Codex test'
      
      const result = await buildCodexBody({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'Hello' }],
        systemInstructions: shortInstructions,
      })

      // Should NOT use the short placeholder
      expect(result.instructions).not.toBe(shortInstructions)
      // Should be much longer (proper Codex instructions from GitHub or fallback)
      expect(typeof result.instructions).toBe('string')
      expect((result.instructions as string).length).toBeGreaterThan(100)
    })

    test('should fetch proper Codex instructions when systemInstructions is not provided', async () => {
      const result = await buildCodexBody({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      // Instructions should be from GitHub or fallback
      expect(typeof result.instructions).toBe('string')
      expect((result.instructions as string).length).toBeGreaterThan(100)
    })

    test('should override provided systemInstructions with GitHub instructions', async () => {
      const legitimateInstructions = `You are an expert coding assistant with deep knowledge of software engineering.
        You help users write clean, maintainable code following best practices.
        Always explain your reasoning and provide examples when helpful.
        Focus on correctness, performance, and readability.
        ${' '.repeat(200)}` // Padding to ensure it's long enough

      const result = await buildCodexBody({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'Hello' }],
        systemInstructions: legitimateInstructions,
      })

      // Should override user instructions with standard Codex instructions
      expect(result.instructions).not.toBe(legitimateInstructions)
      expect(typeof result.instructions).toBe('string')
      expect((result.instructions as string).length).toBeGreaterThan(100)
    })
  })
})
