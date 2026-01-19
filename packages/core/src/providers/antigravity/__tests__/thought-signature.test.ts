
import { describe, it, expect } from 'bun:test'
import { parseResponse } from '../response'
import type { AntigravityResponse } from '../types'

describe('Antigravity Response Parsing - Thought Signatures', () => {
  it('should parse thoughtSignature from thinking blocks', () => {
    const response: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'I am thinking about this.',
                  thought_signature: 'sig_12345',
                },
                {
                  text: 'Here is the answer.',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    if (!result.thinking) throw new Error('Thinking should be defined')
    expect(result.thinking).toHaveLength(1)
    expect(result.thinking[0]).toEqual({
      text: 'I am thinking about this.',
      signature: 'sig_12345',
    })
  })

  it('should parse thoughtSignature from tool calls', () => {
    // Antigravity encodes tool calls as functionCall parts
    // We want to verify that thought_signature on these parts is preserved
    const response: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'test_tool',
                    args: { arg: 'val' },
                  },
                  thought_signature: 'sig_tool_123',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)
    
    // Check that we got a tool call content part
    if (!result.content || result.content.length === 0) throw new Error('Content should be defined')
    expect(result.content).toBeDefined()
    expect(result.content).toHaveLength(1)
    if (!result.content[0]) throw new Error('Content part should be defined')
    expect(result.content[0].type).toBe('tool_call')
    
    // Check that thoughtSignature was preserved on the content part
    expect(result.content[0].thoughtSignature).toBe('sig_tool_123')
  })

  it('should parse thoughtSignature from text parts', () => {
    const response: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: 'Text with signature',
                  thought_signature: 'sig_text_123',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    if (!result.content || result.content.length === 0) throw new Error('Content should be defined')
    expect(result.content).toBeDefined()
    expect(result.content).toHaveLength(1)
    if (!result.content[0]) throw new Error('Content part should be defined')
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('Text with signature')
    expect(result.content[0].thoughtSignature).toBe('sig_text_123')
  })

  it('should handle both camelCase thoughtSignature and snake_case thought_signature', () => {
    const response: AntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'Thinking 1',
                  thoughtSignature: 'sig_camel',
                },
                {
                  thought: true,
                  text: 'Thinking 2',
                  thought_signature: 'sig_snake',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    if (!result.thinking || result.thinking.length < 2) throw new Error('Thinking should be defined and have 2 parts')
    expect(result.thinking).toHaveLength(2)
    // biome-ignore lint/style/noNonNullAssertion: testing purpose
    if (!result.thinking[0]) throw new Error('Thinking part 0 should be defined')
    expect(result.thinking[0].signature).toBe('sig_camel')
    // biome-ignore lint/style/noNonNullAssertion: testing purpose
    if (!result.thinking[1]) throw new Error('Thinking part 1 should be defined')
    expect(result.thinking[1].signature).toBe('sig_snake')
  })
})
