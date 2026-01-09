import { describe, expect, test } from 'bun:test'
import { AnthropicStreamingBuilder } from '../../src/formats/anthropic-messages/anthropic-streaming-builder'

describe('AnthropicStreamingBuilder - Tool Name/ID Handling', () => {
  const model = 'claude-3-opus-20240229'

  test('should start new block when tool ID changes even if tool name is same', () => {
    const builder = new AnthropicStreamingBuilder(model)
    
    // 1. First tool call: Read (ID: call_1)
    const events1 = builder.build({
      type: 'tool_call',
      blockIndex: 0,
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_1', name: 'Read', arguments: { path: 'file1.json' } },
        partialJson: '{\n  "path": "file1.json"\n}'
      }
    })
    
    expect(events1[0]).toContain('"type":"message_start"')
    expect(events1[1]).toContain('"type":"content_block_start"')
    expect(events1[1]).toContain('"index":0')
    expect(events1[1]).toContain('"name":"Read"')
    expect(events1[1]).toContain('"id":"call_1"')
    
    // 2. Second tool call: Read (ID: call_2)
    // Note: The upstream might keep blockIndex: 0 if it treats them as separate candidates or parts in the same request context
    // The builder must identify this as a new block because ID changed.
    const events2 = builder.build({
      type: 'tool_call',
      blockIndex: 0, 
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_2', name: 'Read', arguments: { path: 'file2.json' } },
        partialJson: '{\n  "path": "file2.json"\n}'
      }
    })
    
    // Should stop block 0
    expect(events2[0]).toContain('"type":"content_block_stop"')
    expect(events2[0]).toContain('"index":0')
    
    // Should start block 1
    const blockStart = events2.find(e => e.includes('"type":"content_block_start"'))
    expect(blockStart).toBeDefined()
    expect(blockStart).toContain('"index":1')
    expect(blockStart).toContain('"name":"Read"')
    expect(blockStart).toContain('"id":"call_2"')
    
    // Should have content delta for the second block (using the new index)
    const delta = events2.find(e => e.includes('"type":"content_block_delta"'))
    expect(delta).toBeDefined()
    expect(delta).toContain('"index":1') // This is the CRITICAL check
    expect(delta).toContain('"partial_json":"{\\n  \\"path\\": \\"file2.json\\"\\n}"')
  })
})
