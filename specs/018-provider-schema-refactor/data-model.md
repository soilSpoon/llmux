# Data Model: Provider Schema Refactor

**Status**: ✅ Complete (derived from schemas/unified.md)
**Date**: 2026-01-06

## Overview

This feature's data model consists of the **Unified Schema** - the internal canonical representation that all wire formats convert to/from. This is the "hub" in the hub-and-spoke transformation architecture.

## Core Entities

### 1. UnifiedRequest

The internal representation of an LLM request.

```typescript
interface UnifiedRequest {
  messages: UnifiedMessage[]
  system?: string
  systemBlocks?: SystemBlock[]  // For Anthropic cache_control
  tools?: UnifiedTool[]
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool', name: string }
  config?: GenerationConfig
  thinking?: ThinkingConfig
  metadata?: RequestMetadata
  stream?: boolean
}
```

**Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | `UnifiedMessage[]` | Yes | Conversation messages |
| `system` | `string` | No | Simple system prompt |
| `systemBlocks` | `SystemBlock[]` | No | System with cache control (Anthropic) |
| `tools` | `UnifiedTool[]` | No | Tool definitions |
| `toolChoice` | `ToolChoice` | No | Tool selection strategy |
| `config` | `GenerationConfig` | No | Generation parameters |
| `thinking` | `ThinkingConfig` | No | Reasoning/thinking config |
| `metadata` | `RequestMetadata` | No | Request metadata |
| `stream` | `boolean` | No | Enable streaming |

### 2. UnifiedMessage

A single message in the conversation.

```typescript
interface UnifiedMessage {
  role: 'user' | 'assistant' | 'tool'
  parts: ContentPart[]
}
```

**Relationships**:
- Contains 1+ `ContentPart` instances
- Role is normalized (Gemini's `model` → `assistant`)

### 3. ContentPart

A piece of content within a message.

```typescript
type ContentPart =
  | TextPart
  | ImagePart
  | ToolCallPart
  | ToolResultPart
  | ThinkingPart
```

**Variants**:

| Type | Key Fields | Notes |
|------|------------|-------|
| `TextPart` | `text`, `cacheControl?` | Simple text |
| `ImagePart` | `mimeType`, `data?`, `url?`, `detail?` | Either data or url |
| `ToolCallPart` | `id`, `name`, `arguments` | arguments is always object |
| `ToolResultPart` | `toolCallId`, `content`, `isError?` | content can be string or nested parts |
| `ThinkingPart` | `text`, `signature?` | Anthropic requires signature for round-trip |

### 4. UnifiedResponse

The internal representation of an LLM response.

```typescript
interface UnifiedResponse {
  id: string
  model?: string
  content: ContentPart[]
  stopReason: StopReason | null
  usage?: UsageInfo
  thinking?: ThinkingPart[]
}
```

### 5. UnifiedTool

A tool definition.

```typescript
interface UnifiedTool {
  name: string
  description?: string
  parameters: JSONSchema
  strict?: boolean        // OpenAI structured outputs
  cacheControl?: { type: string }  // Anthropic
}
```

### 6. StreamChunk

A chunk in a streaming response.

```typescript
interface StreamChunk {
  type: 'content' | 'tool_call' | 'thinking' | 'usage' | 'error' | 'done'
  text?: string
  index?: number
  toolCall?: { index, id?, name?, argumentsDelta? }
  thinking?: string
  usage?: UsageInfo
  error?: { message, code? }
  stopReason?: StopReason
}
```

## Entity Relationships

```
UnifiedRequest
├── messages: UnifiedMessage[]
│   └── parts: ContentPart[]
│       ├── TextPart
│       ├── ImagePart
│       ├── ToolCallPart
│       ├── ToolResultPart
│       └── ThinkingPart
├── tools: UnifiedTool[]
├── config: GenerationConfig
└── thinking: ThinkingConfig

UnifiedResponse
├── content: ContentPart[]
├── usage: UsageInfo
└── thinking: ThinkingPart[]
```

## Validation Rules

1. **UnifiedRequest.messages**: Must have at least one message
2. **ContentPart.type**: Must be valid enum value
3. **ImagePart**: Must have either `data` or `url`, not both
4. **ToolCallPart.arguments**: Must be valid object (not string)
5. **ToolResultPart.toolCallId**: Must reference existing tool call
6. **ThinkingPart.signature**: Required if from Anthropic (for round-trip)

## State Transitions

This is a stateless transformation layer. No state transitions apply.

## Full Schema Reference

See [schemas/unified.md](schemas/unified.md) for complete TypeScript definitions.
