import { describe, it, expect } from 'bun:test'
import { StreamingStateMachine } from '../../../src/formats/gemini/streaming/state-machine'
import { AntigravityStreamingParser, type AntigravityParserState } from '../../../src/providers/antigravity/streaming-parser'

describe('Antigravity Streaming State Machine', () => {
  it('should parse simple text chunk', () => {
    const machine = new StreamingStateMachine()
    
    const result = machine.process({ type: 'content', text: 'Hello' })
    
    expect(result.length).toBe(1)
    const chunk = result[0]
    if (chunk && chunk.type === 'text-delta') {
      expect(chunk.text).toBe('Hello')
    } else {
      throw new Error('Expected text-delta chunk')
    }
  })

  it('should parse thinking chunk', () => {
    const machine = new StreamingStateMachine()
    
    const result = machine.process({ type: 'thought', text: 'Hmm', signature: 'sig' })
    
    expect(result.length).toBe(1)
    const chunk = result[0]
    if (chunk && chunk.type === 'thinking-delta') {
      expect(chunk.text).toBe('Hmm')
    } else {
      throw new Error('Expected thinking-delta chunk')
    }
  })

  it('should handle tool call', () => {
    const machine = new StreamingStateMachine()
    
    // 1. Start tool call
    let result = machine.process({ 
      type: 'tool_call', 
      id: 'call_1', 
      name: 'tdGVzdF90b29s', 
      args: '{"a":' 
    })
    expect(result.length).toBe(0) 

    // 2. Continue args
    result = machine.process({ 
      type: 'tool_call', 
      args: '1}' 
    })
    expect(result.length).toBe(0) 

    // 3. Flush 
    result = machine.process({ type: 'done', reason: 'stop' })
    
    expect(result.length).toBe(2) 
    
    const call = result.find(c => c.type === 'tool_call')
    if (call && call.type === 'tool_call') {
      expect(call.toolCall.name).toBe('test_tool')
    } else {
      throw new Error('Expected tool_call chunk')
    }
  })

  it('should treat text with only thoughtSignature as text-delta', () => {
    const parserState: AntigravityParserState = {
      currentBlockType: null,
      currentBlockIndex: 0,
      hasToolUseBlock: false,
      detectedFormat: null,
      finishReason: null,
      finalUsage: null
    }
    const parser = new AntigravityStreamingParser(parserState)
    
    const chunkData = JSON.stringify({
      response: {
        candidates: [{
          content: {
            role: 'model',
            parts: [{
              thoughtSignature: 'some-signature',
              text: '안녕하세요! 무엇을 도와드릴까요?'
            }]
          }
        }]
      }
    })
    
    const result = parser.parse(`data: ${chunkData}`)
    
    expect(result).not.toBeNull()
    if (Array.isArray(result)) {
      expect(result.length).toBe(2)
      const thinking = result[0]
      if (thinking && thinking.type === 'thinking-delta') {
         expect(thinking.delta?.thinking?.signature).toBe('some-signature')
      } else {
         throw new Error('Expected thinking-delta chunk first')
      }

      const first = result[1]
      if (first && first.type === 'text-delta') {
        expect(first.delta?.text).toBe('안녕하세요! 무엇을 도와드릴까요?')
      } else {
        throw new Error('Expected text-delta chunk second')
      }
    }
  })
})