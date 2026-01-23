import { describe, it, expect } from 'bun:test'
import { enforceToolPairingAdjacency } from '../../../src/util/tool-pairing'
import type { UnifiedMessage } from '../../../src/types/unified'

describe('Tool Pairing Adjacency', () => {
  it('should linearize Anthropic-style tool results (role: user)', () => {
    // Input: User -> Assistant(Call) -> User(Result) [Anthropic Style]
    const messages: UnifiedMessage[] = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Call a tool' }]
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            toolCall: { id: 'call_1', name: 'my_tool', arguments: {} }
          }
        ]
      },
      {
        role: 'user',
        parts: [
          {
            type: 'tool_result',
            toolResult: { toolCallId: 'call_1', content: 'Result 1' }
          }
        ]
      }
    ]

    const result = enforceToolPairingAdjacency(messages, true) // strict = true

    expect(result.length).toBe(3)
    expect(result[1]?.role).toBe('assistant')
    const lastMsg = result[2]
    expect(lastMsg?.role).toBe('user')
    if (lastMsg) {
      expect(lastMsg.parts[0]?.type).toBe('tool_result')
      expect(lastMsg.parts[0]?.toolResult?.toolCallId).toBe('call_1')
    }
  })

  it('should reorder Anthropic-style tool results to match call order', () => {
    // Input: Assistant(Call A, Call B) -> User(Result B, Result A)
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [
          { type: 'tool_call', toolCall: { id: 'call_A', name: 'tool_A', arguments: {} } },
          { type: 'tool_call', toolCall: { id: 'call_B', name: 'tool_B', arguments: {} } }
        ]
      },
      {
        role: 'user',
        parts: [
          { type: 'tool_result', toolResult: { toolCallId: 'call_B', content: 'Result B' } },
          { type: 'tool_result', toolResult: { toolCallId: 'call_A', content: 'Result A' } }
        ]
      }
    ]

    const result = enforceToolPairingAdjacency(messages, true)

    expect(result.length).toBe(2)
    const lastMsg = result[1]
    if (lastMsg) {
      // The user message should now have Result A then Result B
      expect(lastMsg.parts[0]?.toolResult?.toolCallId).toBe('call_A')
      expect(lastMsg.parts[1]?.toolResult?.toolCallId).toBe('call_B')
    }
  })

  it('should linearize mixed messages (interleaved text)', () => {
    // Input: Assistant(Call) -> User(Text) -> User(Result)
    // Should become: Assistant(Call) -> User(Result) -> User(Text)
    const messages: UnifiedMessage[] = [
      {
        role: 'assistant',
        parts: [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'tool', arguments: {} } }]
      },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Some interstitial text' }]
      },
      {
        role: 'user',
        parts: [{ type: 'tool_result', toolResult: { toolCallId: 'call_1', content: 'Result' } }]
      }
    ]

    const result = enforceToolPairingAdjacency(messages, true)

    expect(result.length).toBe(2)
    
    // 1. Assistant
    expect(result[0]?.role).toBe('assistant')
    
    // 2. User(Result, Text)
    const lastMsg = result[1]
    expect(lastMsg?.role).toBe('user')
    if (lastMsg) {
      expect(lastMsg.parts.length).toBe(2)
      
      // Result MUST come first
      expect(lastMsg.parts[0]?.type).toBe('tool_result')
      expect(lastMsg.parts[0]?.toolResult?.toolCallId).toBe('call_1')
      
      // Text comes second
      expect(lastMsg.parts[1]?.type).toBe('text')
      expect(lastMsg.parts[1]?.text).toBe('Some interstitial text')
    }
  })
})