
import { describe, expect, it, beforeAll } from 'bun:test'
import { createStreamTransformer, type StreamContext } from '../../src/handlers/stream-transformer'
import { registerProvider, OpencodeZenProvider } from '@llmux/core'

describe('Opencode Zen Regression - Empty Response', () => {
  beforeAll(() => {
    registerProvider(new OpencodeZenProvider())
  })

  it('should NOT return empty response when Anthropic client receives OpenAI formatted response from Opencode Zen', async () => {
    const reqId = 'test-req-id'
    const startTime = Date.now()
    
    const streamContext: StreamContext = {
      reqId,
      fromFormat: 'anthropic-messages',
      targetProvider: 'opencode-zen',
      targetModel: 'glm-4.7-free',
      originalModel: 'claude-3-opus',
      finalModel: 'glm-4.7-free',
      chunkCount: 0,
      totalBytes: 0,
      duration: 0,
      fullResponse: '',
      accumulatedText: '',
      accumulatedThinking: '',
      accumulatedSignatures: [],
      accumulatedUpstream: '',
    }

    const transformer = createStreamTransformer({
      reqId,
      startTime,
      sourceFormat: 'anthropic-messages',
      targetProvider: 'opencode-zen',
      streamContext,
    })

    const writer = transformer.writable.getWriter()
    const reader = transformer.readable.getReader()

    // Simulate the exact response from the log (single JSON object, no data: prefix, no trailing newline)
    const rawResponse = JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          index: 0,
          message: {
            content: 'Amp 코드 작성 에이전트입니다. TypeScript 모노레포인 llmux 프로젝트에서 작업 중입니다.',
            role: 'assistant',
          },
        },
      ],
      created: 1767845414,
      id: '20260108121013d00b1f42fb',
    })

    const chunks: string[] = []
    const decoder = new TextDecoder()
    
    // Read and Write concurrently to avoid backpressure deadlock
    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(decoder.decode(value))
      }
    })()

    await writer.write(new TextEncoder().encode(rawResponse))
    await writer.close()
    await readPromise

    expect(streamContext.chunkCount).toBeGreaterThan(0)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.join('')).toContain('content_block_start')
    expect(chunks.join('')).toContain('Amp 코드')
  }, 10000)
})
