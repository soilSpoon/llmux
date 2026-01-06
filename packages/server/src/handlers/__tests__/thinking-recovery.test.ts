import { describe, expect, it } from 'bun:test'
import {
  analyzeConversationState,
  needsThinkingRecovery,
  closeToolLoopForThinking,
  type ConversationState,
} from '../thinking-recovery'
import type { ConversationMessage } from '../types/thinking-types'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createGeminiUserMessage(text: string): ConversationMessage {
  return { role: 'user', parts: [{ text }] }
}

function createGeminiModelMessage(text: string): ConversationMessage {
  return { role: 'model', parts: [{ text }] }
}

function createGeminiModelWithThinking(text: string, thinking: string): ConversationMessage {
  return {
    role: 'model',
    parts: [{ thought: true, text: thinking }, { text }],
  }
}

function createGeminiModelWithToolCalls(): ConversationMessage {
  return {
    role: 'model',
    parts: [{ functionCall: { name: 'test_tool', args: {} } }],
  }
}

function createGeminiToolResult(result: string): ConversationMessage {
  return {
    role: 'user',
    parts: [{ functionResponse: { name: 'test_tool', response: { result } } }],
  }
}

function createAnthropicUserMessage(text: string): ConversationMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function createAnthropicModelMessage(text: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function createAnthropicModelWithThinking(text: string, thinking: string): ConversationMessage {
  return {
    role: 'assistant',
    content: [{ type: 'thinking', thinking }, { type: 'text', text }],
  }
}

function createAnthropicModelWithToolCalls(): ConversationMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tool_1', name: 'test_tool', input: {} }],
  }
}

function createAnthropicToolResult(result: string): ConversationMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: result }],
  }
}

// ============================================================================
// analyzeConversationState
// ============================================================================

describe('analyzeConversationState', () => {
  describe('empty conversation', () => {
    it('should return all defaults for empty array', () => {
      const result = analyzeConversationState([])
      expect(result).toEqual({
        inToolLoop: false,
        turnStartIdx: -1,
        turnHasThinking: false,
        lastModelIdx: -1,
        lastModelHasThinking: false,
        lastModelHasToolCalls: false,
      })
    })

    it('should return all defaults for undefined input', () => {
      const result = analyzeConversationState(undefined as unknown as ConversationMessage[])
      expect(result.inToolLoop).toBe(false)
      expect(result.lastModelIdx).toBe(-1)
    })
  })

  describe('simple user → model', () => {
    it('should return correct indices for Gemini format', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Hello'),
        createGeminiModelMessage('Hi there'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.inToolLoop).toBe(false)
      expect(result.turnStartIdx).toBe(1)
      expect(result.lastModelIdx).toBe(1)
      expect(result.turnHasThinking).toBe(false)
      expect(result.lastModelHasThinking).toBe(false)
      expect(result.lastModelHasToolCalls).toBe(false)
    })

    it('should return correct indices for Anthropic format', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Hello'),
        createAnthropicModelMessage('Hi there'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.inToolLoop).toBe(false)
      expect(result.turnStartIdx).toBe(1)
      expect(result.lastModelIdx).toBe(1)
    })
  })

  describe('conversation ending with tool result', () => {
    it('should set inToolLoop to true for Gemini format', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Do something'),
        createGeminiModelWithToolCalls(),
        createGeminiToolResult('done'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.inToolLoop).toBe(true)
    })

    it('should set inToolLoop to true for Anthropic format', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Do something'),
        createAnthropicModelWithToolCalls(),
        createAnthropicToolResult('done'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.inToolLoop).toBe(true)
    })
  })

  describe('model message with thinking', () => {
    it('should set turnHasThinking to true for Gemini format', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Hello'),
        createGeminiModelWithThinking('Response', 'My thoughts'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.turnHasThinking).toBe(true)
      expect(result.lastModelHasThinking).toBe(true)
    })

    it('should set turnHasThinking to true for Anthropic format', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Hello'),
        createAnthropicModelWithThinking('Response', 'My thoughts'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.turnHasThinking).toBe(true)
      expect(result.lastModelHasThinking).toBe(true)
    })
  })

  describe('model message with tool calls', () => {
    it('should set lastModelHasToolCalls to true for Gemini format', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Use a tool'),
        createGeminiModelWithToolCalls(),
      ]
      const result = analyzeConversationState(contents)
      expect(result.lastModelHasToolCalls).toBe(true)
    })

    it('should set lastModelHasToolCalls to true for Anthropic format', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Use a tool'),
        createAnthropicModelWithToolCalls(),
      ]
      const result = analyzeConversationState(contents)
      expect(result.lastModelHasToolCalls).toBe(true)
    })
  })

  describe('multiple model messages', () => {
    it('should track the last model message correctly', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Start'),
        createGeminiModelWithThinking('First', 'Thinking 1'),
        createGeminiToolResult('Tool result'),
        createGeminiModelMessage('Second response'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.lastModelIdx).toBe(3)
      expect(result.lastModelHasThinking).toBe(false)
      expect(result.turnHasThinking).toBe(true)
    })

    it('should maintain turnHasThinking even if later messages lack thinking', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Start'),
        createAnthropicModelWithThinking('With thinking', 'Deep thoughts'),
        createAnthropicToolResult('result'),
        createAnthropicModelMessage('Without thinking'),
      ]
      const result = analyzeConversationState(contents)
      expect(result.turnHasThinking).toBe(true)
      expect(result.lastModelHasThinking).toBe(false)
    })
  })
})

// ============================================================================
// needsThinkingRecovery
// ============================================================================

describe('needsThinkingRecovery', () => {
  it('should return true when inToolLoop && !turnHasThinking', () => {
    const state: ConversationState = {
      inToolLoop: true,
      turnStartIdx: 1,
      turnHasThinking: false,
      lastModelIdx: 1,
      lastModelHasThinking: false,
      lastModelHasToolCalls: true,
    }
    expect(needsThinkingRecovery(state)).toBe(true)
  })

  it('should return false when not in tool loop', () => {
    const state: ConversationState = {
      inToolLoop: false,
      turnStartIdx: 1,
      turnHasThinking: false,
      lastModelIdx: 1,
      lastModelHasThinking: false,
      lastModelHasToolCalls: false,
    }
    expect(needsThinkingRecovery(state)).toBe(false)
  })

  it('should return false when has thinking', () => {
    const state: ConversationState = {
      inToolLoop: true,
      turnStartIdx: 1,
      turnHasThinking: true,
      lastModelIdx: 1,
      lastModelHasThinking: true,
      lastModelHasToolCalls: true,
    }
    expect(needsThinkingRecovery(state)).toBe(false)
  })

  it('should return false when both conditions fail', () => {
    const state: ConversationState = {
      inToolLoop: false,
      turnStartIdx: 1,
      turnHasThinking: true,
      lastModelIdx: 1,
      lastModelHasThinking: true,
      lastModelHasToolCalls: false,
    }
    expect(needsThinkingRecovery(state)).toBe(false)
  })
})

// ============================================================================
// closeToolLoopForThinking
// ============================================================================

describe('closeToolLoopForThinking', () => {
  describe('message injection', () => {
    it('should inject synthetic model + user messages', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Do something'),
        createGeminiModelWithToolCalls(),
        createGeminiToolResult('done'),
      ]
      const result = closeToolLoopForThinking(contents)
      expect(result.length).toBe(5)
      const modelMsg = result[3] as { role: string; parts?: unknown[] }
      const userMsg = result[4] as { role: string; parts?: unknown[] }
      expect(modelMsg.role).toBe('model')
      expect(userMsg.role).toBe('user')
    })
  })

  describe('thinking block stripping', () => {
    it('should strip thinking blocks from existing messages (Gemini)', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Hello'),
        createGeminiModelWithThinking('Response', 'Secret thoughts'),
      ]
      const result = closeToolLoopForThinking(contents)
      const modelMsg = result[0] as ConversationMessage
      expect(modelMsg.parts).toBeDefined()
      if (Array.isArray(modelMsg.parts)) {
        const hasThinking = modelMsg.parts.some(
          (p: Record<string, unknown>) => p.thought === true || p.type === 'thinking'
        )
        expect(hasThinking).toBe(false)
      }
    })

    it('should strip thinking blocks from existing messages (Anthropic)', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Hello'),
        createAnthropicModelWithThinking('Response', 'Secret thoughts'),
      ]
      const result = closeToolLoopForThinking(contents)
      const modelMsg = result[1] as ConversationMessage
      expect(modelMsg.content).toBeDefined()
      if (Array.isArray(modelMsg.content)) {
        const hasThinking = modelMsg.content.some(
          (b: Record<string, unknown>) => b.type === 'thinking'
        )
        expect(hasThinking).toBe(false)
      }
    })
  })

  describe('Gemini format', () => {
    it('should use role: model and parts array', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Hello'),
        createGeminiModelWithToolCalls(),
        createGeminiToolResult('result'),
      ]
      const result = closeToolLoopForThinking(contents)
      const syntheticModel = result[result.length - 2] as { role: string; parts?: unknown[] }
      const syntheticUser = result[result.length - 1] as { role: string; parts?: unknown[] }

      expect(syntheticModel.role).toBe('model')
      expect(syntheticModel.parts).toBeDefined()
      expect(Array.isArray(syntheticModel.parts)).toBe(true)

      expect(syntheticUser.role).toBe('user')
      expect(syntheticUser.parts).toBeDefined()
      expect(Array.isArray(syntheticUser.parts)).toBe(true)
    })
  })

  describe('Anthropic format', () => {
    it('should use role: assistant and content array', () => {
      const contents: ConversationMessage[] = [
        createAnthropicUserMessage('Hello'),
        createAnthropicModelWithToolCalls(),
        createAnthropicToolResult('result'),
      ]
      const result = closeToolLoopForThinking(contents)
      const syntheticModel = result[result.length - 2] as { role: string; content?: unknown[] }
      const syntheticUser = result[result.length - 1] as { role: string; content?: unknown[] }

      expect(syntheticModel.role).toBe('assistant')
      expect(syntheticModel.content).toBeDefined()
      expect(Array.isArray(syntheticModel.content)).toBe(true)

      expect(syntheticUser.role).toBe('user')
      expect(syntheticUser.content).toBeDefined()
      expect(Array.isArray(syntheticUser.content)).toBe(true)
    })
  })

  describe('message content reflects tool result count', () => {
    it('should say [Tool execution completed.] for 1 tool result', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Do one thing'),
        createGeminiModelWithToolCalls(),
        createGeminiToolResult('done'),
      ]
      const result = closeToolLoopForThinking(contents)
      const syntheticModel = result[result.length - 2] as { parts?: Array<{ text: string }> }
      expect(syntheticModel.parts?.[0]?.text).toBe('[Tool execution completed.]')
    })

    it('should say [N tool executions completed.] for multiple tool results', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Do many things'),
        createGeminiModelWithToolCalls(),
        createGeminiToolResult('result 1'),
        createGeminiToolResult('result 2'),
        createGeminiToolResult('result 3'),
      ]
      const result = closeToolLoopForThinking(contents)
      const syntheticModel = result[result.length - 2] as { parts?: Array<{ text: string }> }
      expect(syntheticModel.parts?.[0]?.text).toBe('[3 tool executions completed.]')
    })

    it('should say [Processing previous context.] for 0 tool results', () => {
      const contents: ConversationMessage[] = [
        createGeminiUserMessage('Hello'),
        createGeminiModelMessage('Hi there'),
      ]
      const result = closeToolLoopForThinking(contents)
      const syntheticModel = result[result.length - 2] as { parts?: Array<{ text: string }> }
      expect(syntheticModel.parts?.[0]?.text).toBe('[Processing previous context.]')
    })
  })
})

// ============================================================================
// Format detection
// ============================================================================

describe('format detection', () => {
  it('should correctly identify Gemini format (parts array)', () => {
    const contents: ConversationMessage[] = [
      createGeminiUserMessage('Gemini message'),
      createGeminiModelWithToolCalls(),
      createGeminiToolResult('result'),
    ]
    const result = closeToolLoopForThinking(contents)
    const syntheticModel = result[result.length - 2] as Record<string, unknown>
    expect(syntheticModel.role).toBe('model')
    expect(syntheticModel.parts).toBeDefined()
    expect(syntheticModel.content).toBeUndefined()
  })

  it('should correctly identify Anthropic format (content array)', () => {
    const contents: ConversationMessage[] = [
      createAnthropicUserMessage('Anthropic message'),
      createAnthropicModelWithToolCalls(),
      createAnthropicToolResult('result'),
    ]
    const result = closeToolLoopForThinking(contents)
    const syntheticModel = result[result.length - 2] as Record<string, unknown>
    expect(syntheticModel.role).toBe('assistant')
    expect(syntheticModel.content).toBeDefined()
    expect(syntheticModel.parts).toBeUndefined()
  })

  it('should default to Gemini format when no content arrays are present', () => {
    const contents: ConversationMessage[] = [{ role: 'user' } as ConversationMessage]
    const result = closeToolLoopForThinking(contents)
    const syntheticModel = result[result.length - 2] as Record<string, unknown>
    expect(syntheticModel.role).toBe('model')
    expect(syntheticModel.parts).toBeDefined()
  })
})
