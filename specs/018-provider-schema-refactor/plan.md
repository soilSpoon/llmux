# Implementation Plan: Provider Schema Refactor

**Branch**: `018-provider-schema-refactor` | **Date**: 2026-01-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/018-provider-schema-refactor/spec.md`

## Summary

Refactor the `llmux` core to decouple **Provider Identity** from **Schema/Wire Format**. Providers (e.g., 'openai-web', 'opencode-zen') will act as identity/routing layers that select a **Schema Strategy** (e.g., 'OpenAIChat', 'OpenAIResponses', 'AnthropicMessages', 'GoogleGemini') for a given request/model.

## Technical Context

**Language/Version**: TypeScript 5.x (Bun runtime)
**Primary Dependencies**: None new - internal refactor using existing infrastructure
**Storage**: N/A (stateless transformation layer)
**Testing**: Bun test (`bun:test`)
**Target Platform**: Node.js / Bun server
**Project Type**: Monorepo (`packages/core`, `packages/server`)
**Performance Goals**: <5ms p99 latency overhead per streaming chunk
**Constraints**: Zero breaking changes to existing provider tests
**Scale/Scope**: 4 schema formats, 5+ providers to migrate

## Constitution Check

*GATE: Project constitution is template-only. Using AGENTS.md guidelines instead.*

- ✅ **Type Safety**: Strict TypeScript, no `any` types
- ✅ **Testing**: TDD approach - tests first, then implementation
- ✅ **Quality Gates**: `bun run typecheck`, `bun run lint`, `bun run test` must pass

## Related Documents

- [spec.md](spec.md) - Feature specification and requirements
- [test-cases.md](test-cases.md) - Comprehensive test case list (70+ cases)
- [schemas/](schemas/) - Detailed schema specifications per format

---

## Target API Compatibility

| Endpoint | SDK Reference | Format Name |
|----------|---------------|-------------|
| `/v1/chat/completions` | `@ai-sdk/openai-compatible` | `openai-chat` |
| `/v1/responses` | `@ai-sdk/openai` | `openai-responses` |
| `/v1/messages` | `@ai-sdk/anthropic` | `anthropic-messages` |
| `/v1/models/{model}:generateContent` | `@ai-sdk/google` | `google-gemini` |

## Core Principle: Lossless Round-Trip

**A → Unified → A** transformation MUST produce identical output (within format limitations).
- No information loss during parse/transform cycle
- All fields preserved unless format fundamentally doesn't support them

---

## Phase 1: Schema Research & Documentation

### 1.1 OpenAI Chat Completions (`/v1/chat/completions`)
- [x] Request schema analysis (ai-sdk)
- [x] Response schema analysis (ai-sdk)
- [x] Streaming request schema (ai-sdk)
- [x] Streaming response schema (ai-sdk)
- [x] Request/Response schema (litellm)

**Key Findings:**
- Messages: `{ role, content: string | ContentPart[] }`
- Content parts: `{ type: 'text' | 'image_url', ... }`
- Tool calls in assistant message: `tool_calls: [{ id, function: { name, arguments } }]`
- Streaming: `delta` object instead of `message`
- Usage in final chunk with `stream_options: { include_usage: true }`

### 1.2 OpenAI Responses API (`/v1/responses`)
- [x] Request schema analysis (ai-sdk)
- [x] Response schema analysis (ai-sdk)

**Key Findings:**
- Uses `input` field instead of `messages`
- Content types: `input_text`, `input_image`, `input_file` (NOT `text`)
- System via `instructions` field
- Reasoning: `reasoningEffort`, `reasoningSummary`
- Response content: `output_text`

### 1.3 Anthropic Messages (`/v1/messages`)
- [x] Request schema analysis (ai-sdk)
- [x] Response schema analysis (ai-sdk)
- [x] Streaming response schema (ai-sdk)
- [x] Request/Response schema (litellm)

**Key Findings:**
- System prompt: separate `system` array (not in messages)
- Content blocks: `text`, `image`, `tool_use`, `tool_result`, `thinking`
- Tool definition: `input_schema` (JSON Schema)
- Streaming events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`
- Cache control on all blocks

### 1.4 Google Gemini (`/v1/models/{model}:generateContent`)
- [x] Request schema analysis (ai-sdk)
- [x] Response schema analysis (ai-sdk)
- [x] Request/Response schema (litellm)

**Key Findings:**
- Uses `contents` array with `parts`
- Roles: `user`, `model` (not `assistant`)
- Part types: `text`, `inlineData`, `functionCall`, `functionResponse`, `fileData`
- System instruction: separate `systemInstruction` field
- Usage: `usageMetadata` with `promptTokenCount`, `candidatesTokenCount`
- Streaming: same structure with `candidates[].content.parts`

---

## Phase 2: Format Interface Definition

- [ ] Finalize `SchemaFormat` interface in `packages/core/src/formats/base.ts`
  - [ ] Add `FormatId` for all 4 formats
  - [ ] Define `parseRequest`, `buildWireRequest`, `parseResponse`, `buildWireResponse`
  - [ ] Define streaming methods: `parseStreamChunk`, `buildStreamChunk`
  - [ ] Define error parsing: `parseError`
- [ ] Write unit tests for interface compliance (TDD)

---

## Phase 3: Format Implementation (TDD)

### 3.1 OpenAI Chat Format (`openai-chat`)
- [ ] Write tests: `A → Unified → A` round-trip for request
- [ ] Write tests: `A → Unified → A` round-trip for response
- [ ] Write tests: Streaming chunk parsing/building
- [ ] Implement `OpenAIChatFormat` to pass tests
- [ ] Verify against existing `packages/core/src/providers/openai/` logic

### 3.2 OpenAI Responses Format (`openai-responses`)
- [ ] Write tests: `A → Unified → A` round-trip for request
- [ ] Write tests: `A → Unified → A` round-trip for response
- [ ] Write tests: Streaming chunk parsing/building
- [ ] Write tests: `text` → `input_text` conversion
- [ ] Implement `OpenAIResponsesFormat` to pass tests

### 3.3 Anthropic Messages Format (`anthropic-messages`)
- [ ] Write tests: `A → Unified → A` round-trip for request
- [ ] Write tests: `A → Unified → A` round-trip for response
- [ ] Write tests: Streaming event parsing/building
- [ ] Write tests: System prompt handling (separate array)
- [ ] Write tests: Cache control preservation
- [ ] Implement `AnthropicMessagesFormat` to pass tests
- [ ] Verify against existing `packages/core/src/providers/anthropic/` logic

### 3.4 Google Gemini Format (`google-gemini`)
- [ ] Write tests: `A → Unified → A` round-trip for request
- [ ] Write tests: `A → Unified → A` round-trip for response
- [ ] Write tests: Streaming chunk parsing/building
- [ ] Write tests: Role mapping (`assistant` ↔ `model`)
- [ ] Write tests: Function call/response handling
- [ ] Implement `GoogleGeminiFormat` to pass tests

---

## Phase 4: Provider Interface Update

- [ ] Update `Provider` interface in `packages/core/src/providers/base.ts`
  - [ ] Add `getFormatForModel(model: string): SchemaFormat`
  - [ ] Add `getFormatForWireRequest?(request: unknown): SchemaFormat | null`
- [ ] Update `BaseProvider` with default delegation to format
- [ ] Write tests for provider-format composition

---

## Phase 5: Provider Migration

### 5.1 OpenAI Provider
- [ ] Refactor to use `OpenAIChatFormat`
- [ ] Add `OpenAIResponsesFormat` support for future models
- [ ] Run existing tests

### 5.2 OpenAI Web Provider
- [ ] Refactor to use `OpenAIResponsesFormat`
- [ ] Remove inline `text` → `input_text` conversion (now in format)
- [ ] Run existing tests

### 5.3 Anthropic Provider
- [ ] Refactor to use `AnthropicMessagesFormat`
- [ ] Run existing tests

### 5.4 Google/Antigravity Provider
- [ ] Refactor to use `GoogleGeminiFormat`
- [ ] Run existing tests

### 5.5 OpenCode Zen Provider
- [ ] Implement `getFormatForModel` with model-based routing
- [ ] Define `ZEN_MODEL_ROUTING` table
- [ ] Remove provider delegation pattern
- [ ] Run existing tests

---

## Phase 6: Server Integration & Cleanup

- [ ] Verify `packages/server` works with updated providers
- [ ] Verify streaming pipelines
- [ ] Remove dead code from old provider implementations
- [ ] Full test suite: `pnpm run test`
- [ ] Full type check: `pnpm run typecheck`
- [ ] Full build: `pnpm run build`

---

## Quality Gates

Each phase must pass:
- `pnpm run typecheck` - No type errors
- `pnpm run test` - All tests pass
- `pnpm run lint` - No lint errors

---

## Reference: Schema Comparison Table

| Feature | OpenAI Chat | OpenAI Responses | Anthropic | Gemini |
|---------|-------------|------------------|-----------|--------|
| Message field | `messages` | `input` | `messages` | `contents` |
| User role | `user` | `user` | `user` | `user` |
| Assistant role | `assistant` | `assistant` | `assistant` | `model` |
| Text content | `{ type: 'text' }` | `{ type: 'input_text' }` | `{ type: 'text' }` | `{ text: string }` |
| Image content | `{ type: 'image_url' }` | `{ type: 'input_image' }` | `{ type: 'image' }` | `{ inlineData }` |
| Tool call | `tool_calls[]` | `function_call` | `{ type: 'tool_use' }` | `{ functionCall }` |
| Tool result | `{ role: 'tool' }` | `function_call_output` | `{ type: 'tool_result' }` | `{ functionResponse }` |
| System | `{ role: 'system' }` | `instructions` | separate `system` array | `systemInstruction` |
| Streaming | `delta` object | typed events | SSE events | same structure |

---

## Appendix A: Detailed Schema Specifications

### A.1 OpenAI Chat Completions Schema

#### Request
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
  // O-series models
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

#### Response (Non-Streaming)
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

#### Streaming Chunk
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

---

### A.2 OpenAI Responses API Schema

#### Request
```typescript
interface OpenAIResponsesRequest {
  model: string
  input: OpenAIResponsesInput[]
  instructions?: string  // System prompt
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
```

---

### A.3 Anthropic Messages Schema

#### Request
```typescript
interface AnthropicMessagesRequest {
  model: string
  messages: AnthropicMessage[]
  system?: AnthropicTextBlock[]  // Separate from messages!
  tools?: AnthropicTool[]
  tool_choice?: { type: 'auto' | 'any' | 'tool', name?: string }
  max_tokens: number
  temperature?: number
  stream?: boolean
}

type AnthropicMessage =
  | { role: 'user', content: AnthropicUserContent[] }
  | { role: 'assistant', content: AnthropicAssistantContent[] }

type AnthropicUserContent =
  | { type: 'text', text: string, cache_control?: { type: 'ephemeral' } }
  | { type: 'image', source: { type: 'base64', media_type: string, data: string } }
  | { type: 'tool_result', tool_use_id: string, content: string | AnthropicNestedContent[], is_error?: boolean }

type AnthropicAssistantContent =
  | { type: 'text', text: string }
  | { type: 'thinking', thinking: string, signature: string }
  | { type: 'tool_use', id: string, name: string, input: unknown }

interface AnthropicTool {
  name: string
  description?: string
  input_schema: JSONSchema  // NOT 'parameters'
  cache_control?: { type: 'ephemeral' }
}
```

#### Response (Non-Streaming)
```typescript
interface AnthropicMessagesResponse {
  type: 'message'
  id: string
  model: string
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

#### Streaming Events
```typescript
// Event types in order
type AnthropicStreamEvent =
  | { type: 'message_start', message: { id, model, usage, ... } }
  | { type: 'content_block_start', index: number, content_block: { type, ... } }
  | { type: 'content_block_delta', index: number, delta: AnthropicDelta }
  | { type: 'content_block_stop', index: number }
  | { type: 'message_delta', delta: { stop_reason }, usage: { output_tokens } }
  | { type: 'message_stop' }

type AnthropicDelta =
  | { type: 'text_delta', text: string }
  | { type: 'input_json_delta', partial_json: string }
  | { type: 'thinking_delta', thinking: string }
```

---

### A.4 Google Gemini Schema

#### Request
```typescript
interface GeminiRequest {
  contents: GeminiContent[]
  systemInstruction?: { parts: Array<{ text: string }> }
  tools?: Array<{
    functionDeclarations: Array<{
      name: string
      description: string
      parameters: JSONSchema
    }>
  }>
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'NONE' | 'ANY'
      allowedFunctionNames?: string[]
    }
  }
  generationConfig?: {
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    topK?: number
  }
}

interface GeminiContent {
  role: 'user' | 'model'  // NOT 'assistant'!
  parts: GeminiPart[]
}

type GeminiPart =
  | { text: string, thought?: boolean, thoughtSignature?: string }
  | { inlineData: { mimeType: string, data: string } }
  | { fileData: { mimeType: string, fileUri: string } }
  | { functionCall: { name: string, args: unknown }, thoughtSignature?: string }
  | { functionResponse: { name: string, response: unknown } }
```

#### Response
```typescript
interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | null
    safetyRatings?: Array<{ category: string, probability: string }>
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
    cachedContentTokenCount?: number
    thoughtsTokenCount?: number
  }
}
```

---

## Appendix B: Unified Schema (Hub Format)

This is the internal representation all formats convert to/from.

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

interface UnifiedMessage {
  role: 'user' | 'assistant' | 'tool'
  parts: ContentPart[]
}

interface ContentPart {
  type: 'text' | 'image' | 'tool_call' | 'tool_result' | 'thinking'
  text?: string
  image?: { mimeType: string, data?: string, url?: string }
  toolCall?: { id: string, name: string, arguments: Record<string, unknown> | string }
  toolResult?: { toolCallId: string, content: string | ContentPart[], isError?: boolean }
  thinking?: { text: string, signature?: string }
  cacheControl?: { type: string }
  thoughtSignature?: string
}

interface UnifiedTool {
  name: string
  description?: string
  parameters: JSONSchema
}

interface UnifiedResponse {
  id: string
  content: ContentPart[]
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'content_filter' | 'error' | null
  usage?: UsageInfo
  model?: string
  thinking?: ThinkingBlock[]
}

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  thinkingTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
```

---

## Appendix C: Implementation Examples

### C.1 Format Interface Implementation

```typescript
// packages/core/src/formats/base.ts
export interface SchemaFormat {
  readonly id: FormatId

  // Type guards
  isSupportedWireRequest(request: unknown): boolean
  isSupportedWireResponse(response: unknown): boolean

  // Request transformation
  parseRequest(request: unknown): UnifiedRequest
  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown

  // Response transformation
  parseResponse(response: unknown): UnifiedResponse
  buildWireResponse(unified: UnifiedResponse, ctx: FormatContext): unknown

  // Streaming
  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  buildStreamChunk?(chunk: StreamChunk, ctx: FormatContext): string | string[]
}
```

### C.2 OpenAI Chat Format Example

```typescript
// packages/core/src/formats/openai-chat.ts
export const OpenAIChatFormat: SchemaFormat = {
  id: 'openai-chat',

  isSupportedWireRequest(req: unknown): boolean {
    if (!req || typeof req !== 'object') return false
    const r = req as Record<string, unknown>
    // Chat uses 'messages', NOT 'input'
    return typeof r.model === 'string' && Array.isArray(r.messages) && !('input' in r)
  },

  parseRequest(request: unknown): UnifiedRequest {
    const req = request as OpenAIChatRequest
    const result: UnifiedRequest = { messages: [] }

    for (const msg of req.messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        result.system = extractText(msg.content)
      } else {
        result.messages.push(parseMessage(msg))
      }
    }

    if (req.tools) {
      result.tools = req.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as JSONSchema
      }))
    }

    return result
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): OpenAIChatRequest {
    const messages: OpenAIChatMessage[] = []

    if (unified.system) {
      messages.push({ role: 'system', content: unified.system })
    }

    for (const msg of unified.messages) {
      messages.push(buildMessage(msg))
    }

    return {
      model: ctx.model,
      messages,
      tools: unified.tools?.map(buildTool),
      // ... other fields
    }
  },

  // ... response and streaming methods
}
```

### C.3 Round-Trip Test Example

```typescript
// packages/core/test/formats/openai-chat.test.ts
import { describe, it, expect } from 'bun:test'
import { OpenAIChatFormat } from '../../src/formats/openai-chat'

describe('OpenAIChatFormat round-trip', () => {
  it('preserves simple user message', () => {
    const original = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello' }
      ]
    }

    const unified = OpenAIChatFormat.parseRequest(original)
    const rebuilt = OpenAIChatFormat.buildWireRequest(unified, { 
      provider: 'openai', 
      model: 'gpt-4' 
    })

    expect(rebuilt).toEqual(original)
  })

  it('preserves tool calls in assistant message', () => {
    const original = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Seoul"}' }
          }]
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: '{"temp": 25}'
        }
      ]
    }

    const unified = OpenAIChatFormat.parseRequest(original)
    const rebuilt = OpenAIChatFormat.buildWireRequest(unified, {
      provider: 'openai',
      model: 'gpt-4'
    })

    expect(rebuilt).toEqual(original)
  })

  it('preserves multimodal content', () => {
    const original = {
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.png' } }
        ]
      }]
    }

    const unified = OpenAIChatFormat.parseRequest(original)
    const rebuilt = OpenAIChatFormat.buildWireRequest(unified, {
      provider: 'openai',
      model: 'gpt-4o'
    })

    expect(rebuilt).toEqual(original)
  })
})
```

### C.4 Cross-Format Transformation Test

```typescript
// packages/core/test/formats/cross-format.test.ts
describe('Cross-format transformation', () => {
  it('OpenAI Chat → Anthropic → OpenAI Chat preserves content', () => {
    const openaiRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' }
      ]
    }

    // Parse from OpenAI
    const unified = OpenAIChatFormat.parseRequest(openaiRequest)

    // Build to Anthropic
    const anthropicRequest = AnthropicMessagesFormat.buildWireRequest(unified, {
      provider: 'anthropic',
      model: 'claude-3-opus'
    })

    // Verify Anthropic structure
    expect(anthropicRequest.system).toEqual([{ type: 'text', text: 'You are helpful.' }])
    expect(anthropicRequest.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
    ])

    // Parse from Anthropic back
    const unifiedAgain = AnthropicMessagesFormat.parseRequest(anthropicRequest)

    // Build back to OpenAI
    const openaiAgain = OpenAIChatFormat.buildWireRequest(unifiedAgain, {
      provider: 'openai',
      model: 'gpt-4'
    })

    // Should match original
    expect(openaiAgain).toEqual(openaiRequest)
  })
})
```
