import { describe, expect, test } from 'bun:test'
import { buildCodexBody } from '../../src/providers/openai-web'

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
