import { describe, expect, it } from 'bun:test'
import { enforceToolPairingAdjacency } from '../../src/util/tool-pairing'
import type { UnifiedMessage } from '../../src/types/unified'

describe('ToolPairingAdjacency', () => {
  it('should assign IDs to tool calls if missing', () => {
    const input: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { name: 'func', arguments: {} } as any }]
      }
    ]

    const result = enforceToolPairingAdjacency(input, false)
    const toolCallPart = result[0]?.parts[0]
    expect(toolCallPart).toBeDefined()
    if (toolCallPart && 'toolCall' in toolCallPart && toolCallPart.toolCall) {
      expect(toolCallPart.toolCall.id).toBeDefined()
      expect(toolCallPart.toolCall.id).toMatch(/^call_/)
    }
  })

  it('should synthesize missing results in strict mode', () => {
    const input: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'func', arguments: {} } }],
      },
    ]

    const result = enforceToolPairingAdjacency(input, true)

    expect(result.length).toBe(2)
    const lastMsg = result[1]
    expect(lastMsg).toBeDefined()
    if (lastMsg) {
      expect(lastMsg.role).toBe('user')
      const firstPart = lastMsg.parts[0]
      expect(firstPart).toBeDefined()
      if (firstPart && firstPart.type === 'tool_result' && firstPart.toolResult) {
        expect(firstPart.toolResult.isError).toBe(true)
      }
    }
  })

  it('should linearization work via linearizeForClaude (integration)', () => {
    const input: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'func', arguments: {} } }],
      },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'interrupted' }],
      },
      {
        role: 'tool',
        parts: [{ type: 'tool_result', toolResult: { toolCallId: 'call_1', content: 'res' } }],
      },
    ]

    const result = enforceToolPairingAdjacency(input, true)

    // Merged same roles: assistant(call) + user(result + text)
    expect(result.length).toBe(2)
    
    expect(result[0]?.role).toBe('assistant')
    
    expect(result[1]?.role).toBe('user')
    expect(result[1]?.parts[0]?.type).toBe('tool_result')
    expect(result[1]?.parts[1]?.type).toBe('text')
    expect(result[1]?.parts[1]?.text).toBe('interrupted')
  })
})
