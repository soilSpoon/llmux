# Unified Schema (Hub Format)

The internal canonical representation that all wire formats convert to/from.
This is the "hub" in the hub-and-spoke transformation architecture.

## Design Principles

1. **Superset**: Contains all features from all supported formats
2. **Lossless**: No information loss during round-trip within same format
3. **Normalized**: Consistent naming and structure regardless of source
4. **Extensible**: New format-specific features can be added without breaking existing code

## Request Schema

```typescript
interface UnifiedRequest {
  // Core message content
  messages: UnifiedMessage[]
  
  // System prompt (simple string for most cases)
  system?: string
  
  // System blocks with metadata (for Anthropic cache_control)
  systemBlocks?: SystemBlock[]
  
  // Tool definitions
  tools?: UnifiedTool[]
  
  // Tool selection strategy
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool', name: string }
  
  // Generation parameters
  config?: GenerationConfig
  
  // Thinking/reasoning configuration
  thinking?: ThinkingConfig
  
  // Request metadata (user tracking, etc.)
  metadata?: RequestMetadata
  
  // Streaming flag
  stream?: boolean
}

interface SystemBlock {
  type: 'text'
  text: string
  cacheControl?: { type: 'ephemeral' }
}

interface GenerationConfig {
  maxTokens?: number           // Anthropic: required, others: optional
  temperature?: number         // 0-2 for OpenAI, 0-1 for others
  topP?: number
  topK?: number                // Gemini, Anthropic only
  stopSequences?: string[]
  
  // O-series / reasoning models
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  maxCompletionTokens?: number
}

interface ThinkingConfig {
  enabled?: boolean
  effort?: 'none' | 'low' | 'medium' | 'high'
  budgetTokens?: number
}

interface RequestMetadata {
  userId?: string
  requestId?: string
  [key: string]: unknown
}
```

## Message Schema

```typescript
interface UnifiedMessage {
  role: 'user' | 'assistant' | 'tool'
  parts: ContentPart[]
}

type ContentPart =
  | TextPart
  | ImagePart
  | ToolCallPart
  | ToolResultPart
  | ThinkingPart

interface TextPart {
  type: 'text'
  text: string
  cacheControl?: { type: string }
}

interface ImagePart {
  type: 'image'
  mimeType: string
  data?: string      // Base64 encoded
  url?: string       // URL reference
  detail?: 'auto' | 'low' | 'high'  // OpenAI vision detail
  cacheControl?: { type: string }
}

interface ToolCallPart {
  type: 'tool_call'
  id: string
  name: string
  arguments: Record<string, unknown>  // ALWAYS object, stringify when building OpenAI
  thoughtSignature?: string  // Gemini: link to preceding thinking
}

interface ToolResultPart {
  type: 'tool_result'
  toolCallId: string
  content: string | ContentPart[]  // String or nested content (Anthropic)
  isError?: boolean
  cacheControl?: { type: string }
}

interface ThinkingPart {
  type: 'thinking'
  text: string
  signature?: string  // Anthropic: required for round-trip
}
```

## Tool Schema

```typescript
interface UnifiedTool {
  name: string
  description?: string
  parameters: JSONSchema
  strict?: boolean        // OpenAI structured outputs
  cacheControl?: { type: string }  // Anthropic
}

// Standard JSON Schema subset used by all providers
type JSONSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  enum?: unknown[]
  description?: string
  // ... other standard JSON Schema fields
}
```

## Response Schema

```typescript
interface UnifiedResponse {
  id: string
  model?: string
  content: ContentPart[]
  stopReason: StopReason | null
  usage?: UsageInfo
  thinking?: ThinkingPart[]  // Extracted thinking blocks
}

type StopReason =
  | 'end_turn'        // Normal completion
  | 'max_tokens'      // Hit token limit
  | 'tool_use'        // Stopped for tool execution
  | 'stop_sequence'   // Hit stop sequence
  | 'content_filter'  // Blocked by safety filter
  | 'error'           // Transformation or upstream error

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  thinkingTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
```

## Streaming Schema

```typescript
interface StreamChunk {
  type: 'content' | 'tool_call' | 'thinking' | 'usage' | 'error' | 'done'
  
  // For type: 'content'
  text?: string
  index?: number  // Content block index
  
  // For type: 'tool_call'
  toolCall?: {
    index: number
    id?: string        // First chunk only
    name?: string      // First chunk only
    argumentsDelta?: string
  }
  
  // For type: 'thinking'
  thinking?: string
  
  // For type: 'usage'
  usage?: UsageInfo
  
  // For type: 'error'
  error?: {
    message: string
    code?: string
  }
  
  // For type: 'done'
  stopReason?: StopReason
}
```

## Field Mapping Summary

### Role Mapping
| Unified | OpenAI Chat | OpenAI Responses | Anthropic | Gemini |
|---------|-------------|------------------|-----------|--------|
| `user` | `user` | `user` | `user` | `user` |
| `assistant` | `assistant` | `assistant` | `assistant` | `model` |
| `tool` | `tool` | N/A (standalone) | N/A (in user) | N/A (in user/model) |

### Content Type Mapping
| Unified | OpenAI Chat | OpenAI Responses | Anthropic | Gemini |
|---------|-------------|------------------|-----------|--------|
| `text` | `text` | `input_text`/`output_text` | `text` | `{ text }` |
| `image` | `image_url` | `input_image` | `image` | `inlineData`/`fileData` |
| `tool_call` | `tool_calls[]` | `function_call` | `tool_use` | `functionCall` |
| `tool_result` | `{ role: 'tool' }` | `function_call_output` | `tool_result` | `functionResponse` |
| `thinking` | N/A | `reasoning` | `thinking` | `{ thought: true }` |

### System Prompt Mapping
| Unified | Wire Format |
|---------|-------------|
| `system` (string) | OpenAI: `{ role: 'system' }`, Anthropic: `system[]`, Gemini: `systemInstruction` |
| `systemBlocks` (array) | Anthropic: `system[]` with `cache_control` |

### Tool Schema Field Mapping
| Unified | OpenAI | Anthropic | Gemini |
|---------|--------|-----------|--------|
| `parameters` | `parameters` | `input_schema` | `parameters` |
| `arguments` | `arguments` (string) | `input` (object) | `args` (object) |

## Normalization Rules

1. **Arguments**: Store as object when possible, stringify only for OpenAI Chat wire format
2. **Images**: Normalize URL to `url`, base64 to `data` + `mimeType`
3. **Tool results**: Normalize to `toolCallId` (not `tool_call_id`, `tool_use_id`, etc.)
4. **Thinking**: Extract to top-level `thinking` array in response for easy access
5. **Usage**: Normalize all token counts to camelCase (`inputTokens`, not `prompt_tokens`)
6. **Stop reason**: Normalize to consistent enum values

## Validation Rules

1. **Required fields**:
   - `UnifiedRequest.messages`: Must have at least one message
   - `UnifiedMessage.role`: Must be valid role
   - `ContentPart.type`: Must be valid type
   - `ToolCallPart.id`, `ToolCallPart.name`: Required
   - `ToolResultPart.toolCallId`: Required

2. **Type constraints**:
   - `ImagePart`: Must have either `data` or `url`, not both
   - `ToolCallPart.arguments`: If string, must be valid JSON
   - `ThinkingPart.signature`: Required if from Anthropic (for round-trip)

3. **Semantic constraints**:
   - Tool results should reference existing tool call IDs
   - Message order should be user/assistant alternating (with exceptions for tool results)
