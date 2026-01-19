
import { describe, expect, it } from 'bun:test'
import { AntigravityStreamingParser } from '../../../src/providers/antigravity/streaming-parser'

describe('AntigravityStreamingParser', () => {
  const defaultState = {
    currentBlockType: null,
    currentBlockIndex: 0,
    hasToolUseBlock: false,
    detectedFormat: null,
    finishReason: null,
    finalUsage: null,
  }

  it('should parse thinking delta with thoughtSignature (camelCase)', () => {
    const parser = new AntigravityStreamingParser({ ...defaultState })
    const chunk = JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Thinking...',
                  thoughtSignature: 'some-signature',
                },
              ],
            },
          },
        ],
      },
    })

    const result = parser.parse(`data: ${chunk}`)
    expect(result).toEqual([
      {
        type: 'thinking-delta',
        delta: {
          thinking: {
            text: 'Thinking...',
          },
        },
      },
    ])
  })

  it('should parse thinking delta with thought_signature (snake_case)', () => {
    const parser = new AntigravityStreamingParser({ ...defaultState })
    const chunk = JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Thinking...',
                  thought_signature: 'some-signature',
                },
              ],
            },
          },
        ],
      },
    })

    const result = parser.parse(`data: ${chunk}`)
    expect(result).toEqual([
      {
        type: 'thinking-delta',
        delta: {
          thinking: {
            text: 'Thinking...',
          },
        },
      },
    ])
  })

  it('should parse thinking delta with legacy thought field', () => {
    const parser = new AntigravityStreamingParser({ ...defaultState })
    const chunk = JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Thinking...',
                  thought: true,
                },
              ],
            },
          },
        ],
      },
    })

    const result = parser.parse(`data: ${chunk}`)
    expect(result).toEqual([
      {
        type: 'thinking-delta',
        delta: {
          thinking: {
            text: 'Thinking...',
          },
        },
      },
    ])
  })

  it('should parse regular text delta', () => {
    const parser = new AntigravityStreamingParser({ ...defaultState })
    const chunk = JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Hello world',
                },
              ],
            },
          },
        ],
      },
    })

    const result = parser.parse(`data: ${chunk}`)
    expect(result).toEqual([
      {
        type: 'text-delta',
        delta: {
          text: 'Hello world',
        },
      },
    ])
  })
})
