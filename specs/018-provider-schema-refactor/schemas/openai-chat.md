# OpenAI Chat Completions Schema (`openai-chat`)

**Endpoint**: `/v1/chat/completions`
**SDK Reference**: `@ai-sdk/openai-compatible`

## Request Schema

```typescript
interface OpenAIChatRequest {
  model: string
  messages: OpenAIChatMessage[]
  tools?: OpenAIChatTool[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function', function: { name: string } }
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  stream_options?: { include_usage: boolean }
  // O-series models only
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high'
  max_completion_tokens?: number
}

type OpenAIChatMessage =
  | { role: 'system', content: string }
  | { role: 'developer', content: string }  // O-series only
  | { role: 'user', content: string | OpenAIChatContentPart[] }
  | { role: 'assistant', content?: string | null, tool_calls?: OpenAIChatToolCall[] }
  | { role: 'tool', content: string, tool_call_id: string }

type OpenAIChatContentPart =
  | { type: 'text', text: string }
  | { type: 'image_url', image_url: { url: string, detail?: 'auto' | 'low' | 'high' } }

interface OpenAIChatToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }  // arguments is JSON string
}

interface OpenAIChatTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: JSONSchema
    strict?: boolean
  }
}
```

## Response Schema (Non-Streaming)

```typescript
interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAIChatToolCall[]
    }
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}
```

## Streaming Chunk Schema

```typescript
interface OpenAIChatChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: 'assistant'
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string, arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: { ... }  // Only in final chunk with include_usage: true
}
```

## Key Transformation Notes

### Parse (Wire → Unified)
| Wire Field | Unified Field | Notes |
|------------|---------------|-------|
| `messages[role='system']` | `system` | Extract to top-level |
| `messages[role='developer']` | `system` | O-series, treat same as system |
| `messages[role='user'].content` (string) | `parts: [{ type: 'text', text }]` | Wrap in array |
| `messages[role='user'].content` (array) | `parts` | Map `image_url` → `image` |
| `tool_calls[].function.arguments` | `toolCall.arguments` | Keep as string or parse |
| `messages[role='tool']` | `role: 'tool'`, `parts: [{ type: 'tool_result' }]` | Map `tool_call_id` → `toolCallId` |

### Build (Unified → Wire)
| Unified Field | Wire Field | Notes |
|---------------|------------|-------|
| `system` | `{ role: 'system', content }` | Prepend to messages |
| `parts[type='text']` | `{ type: 'text', text }` | Direct map |
| `parts[type='image']` | `{ type: 'image_url', image_url: { url } }` | If `url` present |
| `parts[type='image']` | `{ type: 'image_url', image_url: { url: 'data:...' } }` | If `data` present, encode |
| `toolCall.arguments` (object) | `function.arguments` | JSON.stringify |
| `toolResult` | `{ role: 'tool', tool_call_id, content }` | Serialize content |

## Edge Cases

1. **Empty content**: Assistant message with `content: null` and `tool_calls` present
2. **Streaming tool calls**: `tool_calls` array builds incrementally via `index`
3. **O-series models**: Support `developer` role and `reasoning_effort` field
4. **Usage in streaming**: Only in final chunk when `stream_options.include_usage: true`
