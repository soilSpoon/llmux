import { describe, expect, it } from 'bun:test'
import {
  fixClaudeToolPairing,
  validateToolPairingStrict,
} from '../src/handlers/tool-pairing'
import type { ThinkingBlock, ThinkingMessage } from '../src/handlers/types/thinking-types'

describe('Tool Pairing Validation', () => {
  it('should validate correct tool pairing', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Using tool...' },
          { type: 'tool_use', id: 'call_1', name: 'search' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'Result' },
        ],
      },
    ]

    const result = validateToolPairingStrict(messages)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should detect missing tool_result (no user message)', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search' },
        ],
      },
    ]

    const result = validateToolPairingStrict(messages)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.toolUseId).toBe('call_1')
  })

  it('should detect missing tool_result (user message exists but missing result)', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Just some text' },
        ],
      },
    ]

    const result = validateToolPairingStrict(messages)
    expect(result.valid).toBe(false)
    expect(result.errors[0]!.toolUseId).toBe('call_1')
  })
})

describe('Tool Pairing Repair', () => {
  it('should fix orphaned tool_use by injecting tool_result', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search' },
        ],
      },
    ]

    const fixed = fixClaudeToolPairing(messages)
    
    expect(fixed).toHaveLength(2)
    expect(fixed[1]!.role).toBe('user')
    const content = fixed[1]!.content as ThinkingBlock[]
    expect(content[0]!.type).toBe('tool_result')
    expect(content[0]!.tool_use_id).toBe('call_1')
    expect(content[0]!.is_error).toBe(true)
  })

  it('should merge injected tool_result into existing user message', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'User reply' },
        ],
      },
    ]

    const fixed = fixClaudeToolPairing(messages)
    
    expect(fixed).toHaveLength(2)
    const content = fixed[1]!.content as ThinkingBlock[]
    // Should prepend tool_result
    expect(content).toHaveLength(2)
    expect(content[0]!.type).toBe('tool_result')
    expect(content[0]!.tool_use_id).toBe('call_1')
    expect(content[1]!.type).toBe('text')
  })

  it('should handle multiple orphans correctly', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search' },
          { type: 'tool_use', id: 'call_2', name: 'calculator' },
        ],
      },
    ]

    const fixed = fixClaudeToolPairing(messages)
    
    const content = fixed[1]!.content as ThinkingBlock[]
    expect(content).toHaveLength(2)
    expect(content.find(b => b.tool_use_id === 'call_1')).toBeDefined()
    expect(content.find(b => b.tool_use_id === 'call_2')).toBeDefined()
  })

  it('should verify fix passes validation', () => {
    const messages: ThinkingMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'search' },
        ],
      },
    ]

    const fixed = fixClaudeToolPairing(messages)
    const result = validateToolPairingStrict(fixed)
    expect(result.valid).toBe(true)
  })
})
