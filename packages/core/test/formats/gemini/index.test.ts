import { describe, expect, it, beforeEach } from 'bun:test'
import { GeminiFormat } from '../../../src/formats/gemini/index.js'
import type { UnifiedRequest } from '../../../src/types/unified.js'
import type { GeminiCliRequest } from '../../../src/formats/gemini/gemini-cli/types.js'

describe('GeminiFormat Hub', () => {
    let format: GeminiFormat
    
    beforeEach(() => {
        format = new GeminiFormat()
    })

    it('should route Claude capable models to Antigravity adapter', () => {
        const req: UnifiedRequest = {
            metadata: { model: 'claude-3-5-sonnet', project: 'test-project' },
            messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]
        }

        const res = format.buildWireRequest(req, { model: 'claude-3-5-sonnet', provider: 'antigravity' })
        
        // Antigravity request has 'request' property (envelope)
        expect((res as any).request).toBeDefined()
        expect((res as any).contents).toBeUndefined()
    })

    it('should route standard Gemini models to Gemini-CLI adapter', () => {
        const req: UnifiedRequest = {
            metadata: { model: 'gemini-1.5-pro' },
            messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]
        }

        const res = format.buildWireRequest(req, { model: 'gemini-1.5-pro', provider: 'google' })

        // Gemini-CLI request has 'contents' property directly (no envelope)
        expect((res as any).request).toBeUndefined()
        // Gemini-CLI has 'contents', 'systemInstruction' etc at top level
        expect((res as GeminiCliRequest).contents).toBeDefined()
    })

    it('should use shared response parser for Antigravity-like response', () => {
        const rawRes = {
            candidates: [{
                content: { parts: [{ text: 'Response' }] },
                finishReason: 'STOP'
            }],
            usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 5
            }
        }

        const unified = format.parseResponse(rawRes)
        expect(unified.content[0]).toEqual({ type: 'text', text: 'Response' })
        expect(unified.stopReason).toBe('end_turn')
        expect(unified.usage?.inputTokens).toBe(10)
    })
})
