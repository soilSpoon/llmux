# Anthropic Messages API Schema (`anthropic-messages`)

**Endpoint**: `/v1/messages`
**SDK Reference**: `@ai-sdk/anthropic`

## Request Schema

```typescript
interface AnthropicMessagesRequest {
  model: string
  messages: AnthropicMessage[]
  system?: AnthropicTextBlock[]  // Separate from messages!
  tools?: AnthropicTool[]
  tool_choice?: { type: 'auto' | 'any' | 'tool', name?: string }
  max_tokens: number  // REQUIRED (unlike OpenAI)
  temperature?: number
  top_p?: number
  top_k?: number
  stream?: boolean
  metadata?: { user_id?: string }
}

type AnthropicMessage =
  | { role: 'user', content: AnthropicUserContent[] }
  | { role: 'assistant', content: AnthropicAssistantContent[] }

type AnthropicUserContent =
  | { type: 'text', text: string, cache_control?: { type: 'ephemeral' } }
  | { type: 'image', source: { type: 'base64', media_type: string, data: string }, cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_result', tool_use_id: string, content: string | AnthropicNestedContent[], is_error?: boolean, cache_control?: { type: 'ephemeral' } }
  | { type: 'document', source: { type: 'base64', media_type: string, data: string }, cache_control?: { type: 'ephemeral' } }

type AnthropicAssistantContent =
  | { type: 'text', text: string }
  | { type: 'thinking', thinking: string, signature: string }
  | { type: 'tool_use', id: string, name: string, input: unknown }

type AnthropicNestedContent =
  | { type: 'text', text: string }
  | { type: 'image', source: { type: 'base64', media_type: string, data: string } }

interface AnthropicTool {
  name: string
  description?: string
  input_schema: JSONSchema  // NOT 'parameters'!
  cache_control?: { type: 'ephemeral' }
}

interface AnthropicTextBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}
```

## Response Schema (Non-Streaming)

```typescript
interface AnthropicMessagesResponse {
  type: 'message'
  id: string
  model: string
  role: 'assistant'
  content: AnthropicAssistantContent[]
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null
  stop_sequence?: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}
```

## Streaming Events

```typescript
// SSE format: "event: <type>\ndata: <json>"
// Events arrive in strict order

type AnthropicStreamEvent =
  | { type: 'message_start', message: { id: string, type: 'message', role: 'assistant', model: string, usage: { input_tokens: number } } }
  | { type: 'content_block_start', index: number, content_block: AnthropicContentBlockStart }
  | { type: 'content_block_delta', index: number, delta: AnthropicDelta }
  | { type: 'content_block_stop', index: number }
  | { type: 'message_delta', delta: { stop_reason: string | null, stop_sequence?: string }, usage: { output_tokens: number } }
  | { type: 'message_stop' }

type AnthropicContentBlockStart =
  | { type: 'text', text: '' }
  | { type: 'thinking', thinking: '' }
  | { type: 'tool_use', id: string, name: string, input: {} }

type AnthropicDelta =
  | { type: 'text_delta', text: string }
  | { type: 'thinking_delta', thinking: string }
  | { type: 'input_json_delta', partial_json: string }
  | { type: 'signature_delta', signature: string }
```

## Key Transformation Notes

### Parse (Wire → Unified)
| Wire Field | Unified Field | Notes |
|------------|---------------|-------|
| `system` (array) | `system` or `systemBlocks` | If cache_control present, use `systemBlocks` |
| `messages[].content` | `parts` | Always array (never string) |
| `type: 'image'` | `type: 'image'` | Extract `source.data`, `source.media_type` |
| `type: 'tool_use'` | `type: 'tool_call'` | Map `id`, `name`, `input` → `arguments` |
| `type: 'tool_result'` | `type: 'tool_result'` | Map `tool_use_id` → `toolCallId` |
| `type: 'thinking'` | `type: 'thinking'` | Preserve `signature` |
| `cache_control` | `cacheControl` | Preserve on all blocks |
| `input_schema` | `parameters` | Tool schema field name differs |

### Build (Unified → Wire)
| Unified Field | Wire Field | Notes |
|---------------|------------|-------|
| `system` (string) | `system: [{ type: 'text', text }]` | Wrap in array |
| `systemBlocks` | `system` | Direct use for cache_control |
| `parts[type='text']` | `{ type: 'text', text }` | Direct map |
| `parts[type='image']` | `{ type: 'image', source: { type: 'base64', ... } }` | Always base64 |
| `toolCall.arguments` (object) | `input` | Keep as object (not string!) |
| `toolCall.arguments` (string) | `input` | JSON.parse first |
| `toolResult.content` (string) | `content` (string) | Keep as string |
| `toolResult.content` (array) | `content` (array) | Nested content blocks |
| `parameters` | `input_schema` | Tool schema field name differs |

## Critical Differences from OpenAI

| Aspect | OpenAI Chat | Anthropic |
|--------|-------------|-----------|
| System prompt | In messages array | Separate `system` field |
| Content format | String or array | **Always array** |
| Tool schema field | `parameters` | `input_schema` |
| Tool call arguments | JSON string | **Object** (not string) |
| Tool result location | `{ role: 'tool' }` | Inside `user` message as `tool_result` |
| Image encoding | URL or base64 data URI | Explicit `{ type: 'base64', data, media_type }` |
| Streaming format | Single `delta` object | Multiple event types |
| `max_tokens` | Optional | **Required** |
| Thinking/reasoning | Not exposed | Explicit `thinking` blocks |
| Cache control | Not supported | `cache_control` on any block |

## Edge Cases

1. **`max_tokens` required**: Must provide, no default. Use `4096` as fallback if not in UnifiedRequest (same as LiteLLM).
2. **Content always array**: Even single text must be `[{ type: 'text', text }]`, never string.
3. **Tool arguments object**: Anthropic uses `input: object`, OpenAI uses `arguments: string`. Parse/stringify accordingly.
4. **Tool results in user message**: `tool_result` blocks go in the next `user` message, not standalone.
5. **Nested tool result content**: Can contain text and images, not just string.
6. **Thinking blocks**: Have `signature` field that must be preserved for round-trip.
7. **Cache control**: Can appear on system, messages, tools - preserve all.
8. **Streaming tool calls**: Build `input` via `input_json_delta` events, JSON may be partial/invalid until complete.
