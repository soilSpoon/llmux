# Unified Streaming Model

The Unified Streaming Model in llmux provides a consistent way to handle streaming responses from various providers (Anthropic, OpenAI, Gemini, Antigravity, etc.). Based on the Hub-and-Spoke architecture, it transforms provider-specific SSE events into a unified `StreamChunk` and then converts them to the target provider's format.

## Core Concepts

### StreamChunk

`StreamChunk` is the atomic unit of streaming data.

```typescript
export interface StreamChunk {
  type: 'content' | 'tool_call' | 'tool_result' | 'thinking' | 'usage' | 'block_stop' | 'done' | 'error'

  /** 0-based block index for multi-block streaming (defaults to 0 for single-block providers) */
  blockIndex?: number

  /** Type of the content block this chunk belongs to */
  blockType?: ContentPart['type']

  delta?: StreamDelta
  usage?: UsageInfo
  stopReason?: StopReason
  error?: string
}
```

### Multi-block Streaming

Models like Anthropic Claude can stream multiple content blocks (text, tool calls, thinking) sequentially or in parallel within a single response. To support this, `blockIndex` and `blockType` fields were introduced.

- **blockIndex**: The index of the block this chunk belongs to (0-based).
- **blockType**: The type of the block (`text`, `tool_call`, `thinking`, etc.).
- **block_stop**: Event type indicating the completion of a specific block.

### Provider Mapping

#### Anthropic (Source)
- `content_block_start`: Sets `blockIndex` and `blockType`.
- `content_block_delta`: Adds data to the block at `blockIndex`.
- `content_block_stop`: Emits `type: 'block_stop'`.

#### OpenAI (Source)
- `choices[].index` maps to `blockIndex`.
- `choices[].delta` determines `blockType` (`text`, `tool_call`, `thinking`, etc.).

#### Gemini (Source)
- `candidate.index` maps to `blockIndex`.
- `parts` determines `blockType`.

#### Antigravity (Source)
- Follows the **Gemini** mapping strategy.
- Uses `candidates[].content.parts[]` to determine `blockType`.

#### OpenAI Responses (Source)

The OpenAI Responses API uses a different event structure from the standard Chat Completions API. Below is the complete mapping:

| Responses API Event | StreamChunk Type | Delta/Payload | Notes |
|---------------------|------------------|---------------|-------|
| `response.created` | `done` | `responseMetadata` | Initial response metadata, `skipStopDelta: true` |
| `response.in_progress` | `done` | `responseMetadata` | Response in progress, `skipStopDelta: true` |
| `response.content_part.added` | `content` | `{}` (empty delta) | Signals start of text content block |
| `response.output_text.delta` | `content` | `delta.text` | Streaming text content |
| `response.output_text.done` | `block_stop` | `delta.text` (full text) | Text block completion with final content |
| `response.content_part.done` | `block_stop` | N/A | Text block completion signal |
| `response.reasoning_summary_part.added` | `thinking-start` | `blockType: 'thinking'` | Signals start of reasoning block |
| `response.reasoning_summary_text.delta` | `thinking` | `delta.thinking.text` | Streaming reasoning content |
| `response.reasoning_summary_text.done` | `thinking-end` | `delta.thinking.text` | Reasoning block completion |
| `response.reasoning_summary_part.done` | `thinking-end` | N/A | Reasoning block completion signal |
| `response.output_item.added` | `tool_call` | `delta.toolCall` (id, name) | Function call start (when `item.type === 'function_call'`) |
| `response.function_call_arguments.delta` | `tool_call` | `delta.partialJson` | Streaming function arguments |
| `response.output_item.done` | `tool_call` / `content` | Complete item data | Function call or message completion |
| `response.completed` | `usage` + `done` | Token usage, `stopReason` | Final completion event |
| `response.failed` | `error` | `error` (JSON string) | Error event |

**Key Differences from Chat Completions API:**
- Uses dedicated lifecycle events (`content_part.added`, `content_part.done`) for block boundaries
- Reasoning/thinking uses separate `reasoning_summary_*` events
- Function calls use `output_item.added/done` and `function_call_arguments.delta`
- Response metadata extracted from `response.created`/`response.in_progress` for lossless round-trip


## Event Types

| Type | Description | Payload (Delta) |
|------|-------------|-----------------|
| `content` | Text content streaming | `text` |
| `tool_call` | Tool call info/args | `toolCall` (id, name), `partialJson` (args) |
| `thinking` | Chain of Thought (CoT) | `thinking` (text, signature) |
| `thinking-start` | Start of thinking block | `blockIndex` |
| `thinking-end` | End of thinking block | `blockIndex`, `delta.thinking` |
| `usage` | Token usage info | `usage` (input/output tokens) |
| `block_stop` | Block completion signal | N/A |
| `done` | Stream completion | `stopReason`, `responseMetadata` |
| `error` | Error occurred | `error` (message) |

## Usage Examples

### Block Lifecycle Events

The `thinking-start`, `thinking-end`, and `block_stop` events enable proper handling of block boundaries during streaming:

```typescript
// Example: Processing a stream with thinking and text blocks
async function* processStream(stream: AsyncIterable<StreamChunk>) {
  const blocks: Map<number, { type: string; content: string }> = new Map()

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'thinking-start':
        // Initialize a new thinking block
        blocks.set(chunk.blockIndex ?? 0, { type: 'thinking', content: '' })
        console.log(`[Block ${chunk.blockIndex}] Thinking started`)
        break

      case 'thinking':
        // Accumulate thinking content
        const thinkingBlock = blocks.get(chunk.blockIndex ?? 0)
        if (thinkingBlock && chunk.delta?.thinking) {
          const text = typeof chunk.delta.thinking === 'string'
            ? chunk.delta.thinking
            : chunk.delta.thinking.text
          thinkingBlock.content += text
        }
        break

      case 'thinking-end':
        // Finalize thinking block
        console.log(`[Block ${chunk.blockIndex}] Thinking completed`)
        break

      case 'content':
        // Handle text content
        if (!blocks.has(chunk.blockIndex ?? 0)) {
          blocks.set(chunk.blockIndex ?? 0, { type: 'text', content: '' })
        }
        if (chunk.delta?.text) {
          blocks.get(chunk.blockIndex ?? 0)!.content += chunk.delta.text
        }
        break

      case 'block_stop':
        // Block is complete - can now process the full block
        const completedBlock = blocks.get(chunk.blockIndex ?? 0)
        console.log(`[Block ${chunk.blockIndex}] Completed:`, completedBlock)
        yield completedBlock
        break

      case 'done':
        console.log('Stream completed with reason:', chunk.stopReason)
        break
    }
  }
}
```

### OpenAI Responses API Stream Example

```typescript
// Example: Handling OpenAI Responses API events
import { parseStreamChunk } from '@llmux/core'

async function handleResponsesStream(sseEvents: string[]) {
  const results: StreamChunk[] = []

  for (const event of sseEvents) {
    const chunk = parseStreamChunk(event)
    if (!chunk) continue

    // Handle array of chunks (e.g., from response.completed)
    const chunks = Array.isArray(chunk) ? chunk : [chunk]

    for (const c of chunks) {
      results.push(c)

      // Example: Track reasoning/thinking blocks
      if (c.type === 'thinking-start') {
        console.log('Model started reasoning...')
      } else if (c.type === 'thinking') {
        console.log('Reasoning:', c.delta?.thinking)
      } else if (c.type === 'thinking-end') {
        console.log('Reasoning completed')
      }

      // Example: Track content blocks
      if (c.type === 'content' && c.delta?.text) {
        process.stdout.write(c.delta.text)
      } else if (c.type === 'block_stop') {
        console.log('\n[Content block completed]')
      }
    }
  }

  return results
}
```

## Extended Features

### Redacted Thinking
Anthropic's `redacted_thinking` block is represented as a `ThinkingBlock` with `redacted: true`. This indicates thinking process that is hidden for safety reasons.

### Tool Result
While not part of the streaming response itself, the `UnifiedResponse` includes `tool_result` type to represent tool execution results.

## Implementation Details

All provider implementations (`streaming.ts`) must adhere to this Unified Streaming Model. They are responsible for parsing their specific SSE format into this model or transforming this model into their specific SSE format.
