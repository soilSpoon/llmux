import { describe, expect, it, beforeAll } from 'bun:test'
import { createStreamTransformer } from '../../src/handlers/stream-transformer'
import { OpenAIProvider, registerProvider } from '@llmux/core'

describe('OpenAI Responses Streaming support', () => {
    beforeAll(() => {
        registerProvider(new OpenAIProvider())
    })

    it('should correctly initialize OpenAIResponsesStreamingBuilder for openai-responses format', async () => {
        const streamContext: any = { 
            reqId: 'test-stream',
            finalModel: 'gpt-4',
            originalModel: 'gpt-4',
            totalBytes: 0,
            accumulatedUpstream: '',
            accumulatedText: '',
            accumulatedThinking: '',
            fullResponse: '',
            chunkCount: 0,
            duration: 0
        }
        
        const transformer = createStreamTransformer({
            sourceFormat: 'openai-responses',
            targetProvider: 'openai',
            streamContext,
            startTime: Date.now()
        } as any)

        const encoder = new TextEncoder()
        const decoder = new TextDecoder()
        
        const writer = transformer.writable.getWriter()
        const reader = transformer.readable.getReader()

        // Mock a chunk in OpenAI format
        const chunk = 'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
        
        let warningLogged = false
        const originalWarn = console.warn
        console.warn = (...args: any[]) => {
            if (args[0] && typeof args[0] === 'string' && (args[0].includes('No streaming builder available') || args[0].includes('builder missing'))) {
                warningLogged = true
            }
            originalWarn(...args)
        }

        const readPromise = (async () => {
            let result = ''
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                result += decoder.decode(value)
            }
            return result
        })()

        await writer.write(encoder.encode(chunk))
        await writer.close()
        
        const transformed = await readPromise
        
        console.warn = originalWarn
        
        expect(warningLogged).toBe(false)
        expect(transformed).toBeDefined()
        // OpenAIResponsesStreamingBuilder should convert gpt-4 chunks into response events
        expect(transformed).toContain('response.created')
        expect(transformed).toContain('response.output_text.delta')
        expect(transformed).toContain('Hi')
    })
})
