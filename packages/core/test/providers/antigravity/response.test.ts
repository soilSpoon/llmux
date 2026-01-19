import { describe, expect, it } from 'bun:test'
import { parseResponse } from '../../../src/providers/antigravity/response'

describe('Antigravity Response Parsing', () => {
  it('should parse thinking block with thoughtSignature', () => {
    const response = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Thinking process...',
                  thoughtSignature: 'sig123',
                },
                {
                  text: 'Final response',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'resp-123',
      },
    }

    const result = parseResponse(response)

    expect(result.thinking).toHaveLength(1)
    expect(result.thinking![0]).toEqual({
      text: 'Thinking process...',
      signature: 'sig123',
    })
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Final response',
    })
  })

  it('should parse thinking block with snake_case thought_signature', () => {
    const response = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Thinking process...',
                  thought_signature: 'sig456',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    expect(result.thinking).toHaveLength(1)
    expect(result.thinking![0]).toEqual({
      text: 'Thinking process...',
      signature: 'sig456',
    })
  })

  it('should preserve thoughtSignature on text parts', () => {
    const response = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Response with signature',
                  thoughtSignature: 'sig789',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Response with signature',
      thoughtSignature: 'sig789',
    })
  })

  it('should preserve thoughtSignature on tool calls', () => {
    const response = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'tool_name',
                    args: {},
                  },
                  thoughtSignature: 'sigABC',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    expect(result.content[0]).toMatchObject({
      type: 'tool_call',
      thoughtSignature: 'sigABC',
    })
  })

  it('should parse thinking block with thought: true but no text field (assuming empty text)', () => {
    const response = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  thoughtSignature: 'sigEmpty',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    }

    const result = parseResponse(response)

    expect(result.thinking).toHaveLength(1)
    expect(result.thinking![0]).toEqual({
      text: '',
      signature: 'sigEmpty',
    })
  })
})
