# OpenAI Responses API Schema (`openai-responses`)

**Endpoint**: `/v1/responses`
**SDK Reference**: `@ai-sdk/openai`

## Request Schema

```typescript
interface OpenAIResponsesRequest {
  model: string
  input: OpenAIResponsesInput[]
  instructions?: string  // System prompt (separate from input)
  tools?: OpenAIResponsesTool[]
  reasoning?: { effort?: 'none' | 'low' | 'medium' | 'high' }
  max_output_tokens?: number
  store?: boolean
  stream?: boolean
}

type OpenAIResponsesInput =
  | { role: 'system', content: string }
  | { role: 'user', content: OpenAIResponsesUserContent[] }
  | { role: 'assistant', content: Array<{ type: 'output_text', text: string }> }
  | OpenAIResponsesFunctionCall
  | OpenAIResponsesFunctionCallOutput

type OpenAIResponsesUserContent =
  | { type: 'input_text', text: string }
  | { type: 'input_image', image_url: string }
  | { type: 'input_image', file_id: string }
  | { type: 'input_file', file_url: string }
  | { type: 'input_file', filename: string, file_data: string }

interface OpenAIResponsesFunctionCall {
  type: 'function_call'
  id: string
  call_id: string
  name: string
  arguments: string
}

interface OpenAIResponsesFunctionCallOutput {
  type: 'function_call_output'
  call_id: string
  output: string
}

interface OpenAIResponsesTool {
  type: 'function'
  name: string
  description?: string
  parameters?: JSONSchema
  strict?: boolean
}
```

## Response Schema

```typescript
interface OpenAIResponsesResponse {
  id: string
  object: 'response'
  created_at: number
  model: string
  output: OpenAIResponsesOutput[]
  status: 'completed' | 'failed' | 'cancelled' | 'in_progress'
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  }
}

type OpenAIResponsesOutput =
  | { type: 'message', id: string, role: 'assistant', content: Array<{ type: 'output_text', text: string }> }
  | { type: 'function_call', id: string, call_id: string, name: string, arguments: string }
  | { type: 'reasoning', id: string, summary: Array<{ type: 'summary_text', text: string }> }
```

## Streaming Events

```typescript
// Event types (SSE format: "event: <type>\ndata: <json>")
type OpenAIResponsesStreamEvent =
  | { type: 'response.created', response: { id, model, status } }
  | { type: 'response.in_progress', response: { id } }
  | { type: 'response.output_item.added', output_index: number, item: { type, id } }
  | { type: 'response.content_part.added', output_index: number, content_index: number, part: { type } }
  | { type: 'response.output_text.delta', output_index: number, content_index: number, delta: string }
  | { type: 'response.output_text.done', output_index: number, content_index: number, text: string }
  | { type: 'response.function_call_arguments.delta', output_index: number, delta: string }
  | { type: 'response.function_call_arguments.done', output_index: number, arguments: string }
  | { type: 'response.output_item.done', output_index: number, item: OpenAIResponsesOutput }
  | { type: 'response.completed', response: OpenAIResponsesResponse }
  | { type: 'response.failed', response: { error: { message, code } } }
```

## Key Transformation Notes

### Parse (Wire → Unified)
| Wire Field | Unified Field | Notes |
|------------|---------------|-------|
| `instructions` | `system` | Top-level system prompt |
| `input[role='system']` | Append to `system` | Concatenate if both present |
| `input[type='input_text']` | `parts: [{ type: 'text', text }]` | Note type name difference |
| `input[type='input_image']` | `parts: [{ type: 'image', url }]` | Map `image_url` → `url` |
| `input[type='output_text']` | `parts: [{ type: 'text', text }]` | Assistant content |
| `function_call` | `parts: [{ type: 'tool_call', ... }]` | Map `call_id` → `id` |
| `function_call_output` | `parts: [{ type: 'tool_result', ... }]` | Map `call_id` → `toolCallId` |
| `reasoning.effort` | `thinking.effort` | Direct map |

### Build (Unified → Wire)
| Unified Field | Wire Field | Notes |
|---------------|------------|-------|
| `system` | `instructions` | Prefer `instructions` over inline |
| `parts[type='text']` (user) | `{ type: 'input_text', text }` | **CRITICAL**: type name differs |
| `parts[type='text']` (assistant) | `{ type: 'output_text', text }` | **CRITICAL**: type name differs |
| `parts[type='image']` | `{ type: 'input_image', image_url }` | Map `url` → `image_url` |
| `toolCall` | `{ type: 'function_call', call_id, ... }` | Map `id` → `call_id` |
| `toolResult` | `{ type: 'function_call_output', ... }` | Standalone item, not in message |

## Critical Differences from OpenAI Chat

| Aspect | Chat | Responses |
|--------|------|-----------|
| Message container | `messages` | `input` |
| System prompt | `{ role: 'system' }` in messages | `instructions` field |
| Text content type (user) | `text` | `input_text` |
| Text content type (assistant) | `text` | `output_text` |
| Image content type | `image_url` | `input_image` |
| Tool call location | `assistant.tool_calls[]` | Standalone `function_call` item |
| Tool result location | `{ role: 'tool' }` message | Standalone `function_call_output` item |
| Response structure | `choices[0].message` | `output[]` |

## Edge Cases

1. **`text` vs `input_text`**: Incoming Chat-format requests may use `text` - must convert to `input_text`
2. **Tool calls not in messages**: `function_call` and `function_call_output` are top-level items in `input`, not nested in messages
3. **Streaming event types**: Completely different from Chat (not `delta` object)
4. **File uploads**: Supports `input_file` with `file_data` (base64) - no Chat equivalent
