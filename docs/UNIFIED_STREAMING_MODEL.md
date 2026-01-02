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


## Event Types

| Type | Description | Payload (Delta) |
|------|-------------|-----------------|
| `content` | Text content streaming | `text` |
| `tool_call` | Tool call info/args | `toolCall` (id, name), `partialJson` (args) |
| `thinking` | Chain of Thought (CoT) | `thinking` (text, signature) |
| `usage` | Token usage info | `usage` (input/output tokens) |
| `block_stop` | Block completion signal | N/A |
| `done` | Stream completion | `stopReason` |
| `error` | Error occurred | `error` (message) |

## Extended Features

### Redacted Thinking
Anthropic's `redacted_thinking` block is represented as a `ThinkingBlock` with `redacted: true`. This indicates thinking process that is hidden for safety reasons.

### Tool Result
While not part of the streaming response itself, the `UnifiedResponse` includes `tool_result` type to represent tool execution results.

## Implementation Details

All provider implementations (`streaming.ts`) must adhere to this Unified Streaming Model. They are responsible for parsing their specific SSE format into this model or transforming this model into their specific SSE format.
