import { describe, expect, it, beforeEach } from 'bun:test'
import { GeminiFormat } from '../../../src/formats/gemini/index.js'
import { ToolNameCodec } from '../../../src/util/tool-name-codec.js'
import type { GeminiResponse } from '../../../src/formats/gemini/shared/response.js'

describe('GeminiFormat Hub Response', () => {
  let format: GeminiFormat
  let codec: ToolNameCodec

  beforeEach(() => {
    codec = new ToolNameCodec()
    format = new GeminiFormat()
  })

  it('should transform response with tool name decoding and thinking block', () => {
    const encodedName = codec.encode('my_long_function')

    const res: GeminiResponse = {
      candidates: [
        {
          index: 0,
          content: {
            role: 'model',
            parts: [{ text: 'Here is the result.' }, { functionCall: { name: encodedName, args: { x: 1 } } }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    }

    const unifiedRes = format.parseResponse(res)

    expect(unifiedRes.content).toHaveLength(2)

    const secondContent = unifiedRes.content[1]
    expect(secondContent).toBeDefined()
    expect(secondContent?.type).toBe('tool_call')

    const toolCall = secondContent?.toolCall
    expect(toolCall).toBeDefined()
    if (toolCall) {
      expect(toolCall.name).toBe('my_long_function')
    }

    expect(unifiedRes.usage).toBeDefined()
    if (unifiedRes.usage) {
      expect(unifiedRes.usage.inputTokens).toBe(10)
    }
  })
})
