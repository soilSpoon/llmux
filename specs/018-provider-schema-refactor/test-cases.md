# Test Cases for Provider Schema Refactor

Comprehensive test case specification for round-trip transformations and edge cases.

## Test Categories

1. **Round-Trip Tests (A → Unified → A)**: Same-format parse/build preserves data
2. **Cross-Format Tests (A → Unified → B)**: Different-format transformation maintains semantics
3. **Streaming Tests**: Chunk parsing and building
4. **Edge Case Tests**: Error handling, malformed data, unsupported features
5. **Integration Tests**: End-to-end with real provider responses

---

## 1. Round-Trip Tests

### 1.1 OpenAI Chat Format

| Test ID | Description | Input Fixture | Validation |
|---------|-------------|---------------|------------|
| `OAC-RT-001` | Simple user message | `{ role: 'user', content: 'Hello' }` | `deepEqual(input, output)` |
| `OAC-RT-002` | System + user message | System role preserved and positioned first | Exact match |
| `OAC-RT-003` | Multimodal (text + image URL) | `content: [{ type: 'text' }, { type: 'image_url' }]` | Exact match |
| `OAC-RT-004` | Multimodal (image base64 data URI) | `image_url: { url: 'data:image/png;base64,...' }` | Exact match |
| `OAC-RT-005` | Assistant with tool_calls | `tool_calls: [{ id, function: { name, arguments } }]` | Exact match, arguments string preserved |
| `OAC-RT-006` | Tool result message | `{ role: 'tool', tool_call_id, content }` | Exact match |
| `OAC-RT-007` | Multiple tool calls | 3+ tool calls in single assistant message | All preserved with correct indices |
| `OAC-RT-008` | Empty assistant content with tool calls | `content: null, tool_calls: [...]` | `null` preserved, not empty string |
| `OAC-RT-009` | Developer role (O-series) | `{ role: 'developer', content }` | Preserved as developer |
| `OAC-RT-010` | Reasoning effort | `reasoning_effort: 'high'` | Preserved |
| `OAC-RT-011` | Stream options | `stream_options: { include_usage: true }` | Preserved |
| `OAC-RT-012` | Tool with strict mode | `strict: true` on tool definition | Preserved |
| `OAC-RT-013` | Full conversation (5+ turns) | User/assistant/tool alternation | Order and content preserved |

### 1.2 OpenAI Responses Format

| Test ID | Description | Input Fixture | Validation |
|---------|-------------|---------------|------------|
| `OAR-RT-001` | Simple input_text | `{ type: 'input_text', text: 'Hello' }` | Exact match |
| `OAR-RT-002` | Instructions field | `instructions: 'You are helpful'` | Preserved as instructions |
| `OAR-RT-003` | Input image | `{ type: 'input_image', image_url: '...' }` | Exact match |
| `OAR-RT-004` | Input file with data | `{ type: 'input_file', filename, file_data }` | Exact match |
| `OAR-RT-005` | Function call item | `{ type: 'function_call', call_id, name, arguments }` | Exact match |
| `OAR-RT-006` | Function call output | `{ type: 'function_call_output', call_id, output }` | Exact match |
| `OAR-RT-007` | Reasoning config | `reasoning: { effort: 'medium' }` | Preserved |
| `OAR-RT-008` | Output text in response | `{ type: 'output_text', text }` | Exact match |

### 1.3 Anthropic Messages Format

| Test ID | Description | Input Fixture | Validation |
|---------|-------------|---------------|------------|
| `ANT-RT-001` | Simple text array | `content: [{ type: 'text', text }]` | Exact match (array, not string) |
| `ANT-RT-002` | Separate system array | `system: [{ type: 'text', text }]` | Preserved separate from messages |
| `ANT-RT-003` | System with cache_control | `cache_control: { type: 'ephemeral' }` | Preserved |
| `ANT-RT-004` | Image content | `{ type: 'image', source: { type: 'base64', ... } }` | Exact match |
| `ANT-RT-005` | Tool use block | `{ type: 'tool_use', id, name, input }` | `input` stays object |
| `ANT-RT-006` | Tool result block | `{ type: 'tool_result', tool_use_id, content }` | Preserved in user message |
| `ANT-RT-007` | Nested tool result content | `content: [{ type: 'text' }, { type: 'image' }]` | Nested structure preserved |
| `ANT-RT-008` | Tool result with is_error | `is_error: true` | Preserved |
| `ANT-RT-009` | Thinking block | `{ type: 'thinking', thinking, signature }` | Signature preserved |
| `ANT-RT-010` | Tool with input_schema | `input_schema: {...}` | Not renamed to parameters |
| `ANT-RT-011` | Cache control on tool | Tool with `cache_control` | Preserved |
| `ANT-RT-012` | max_tokens required | `max_tokens: 4096` | Preserved, not dropped |

### 1.4 Google Gemini Format

| Test ID | Description | Input Fixture | Validation |
|---------|-------------|---------------|------------|
| `GEM-RT-001` | Simple text part | `parts: [{ text: 'Hello' }]` | No `type` field, just `text` |
| `GEM-RT-002` | Model role | `role: 'model'` | Not converted to 'assistant' |
| `GEM-RT-003` | systemInstruction | `systemInstruction: { parts: [{ text }] }` | Structure preserved |
| `GEM-RT-004` | Inline data image | `{ inlineData: { mimeType, data } }` | Exact match |
| `GEM-RT-005` | File data | `{ fileData: { mimeType, fileUri } }` | Preserved |
| `GEM-RT-006` | Function call | `{ functionCall: { name, args } }` | `args` stays object |
| `GEM-RT-007` | Function response | `{ functionResponse: { name, response } }` | `name` preserved |
| `GEM-RT-008` | Thinking part | `{ text, thought: true, thoughtSignature }` | All fields preserved |
| `GEM-RT-009` | Function call after thinking | `functionCall` with `thoughtSignature` | Signature preserved |
| `GEM-RT-010` | Tool config | `toolConfig: { functionCallingConfig: { mode: 'AUTO' } }` | Preserved |
| `GEM-RT-011` | Generation config | `generationConfig: { maxOutputTokens, temperature }` | Preserved |

---

## 2. Cross-Format Tests

### 2.1 OpenAI Chat ↔ Anthropic

| Test ID | Description | Source | Target | Validation |
|---------|-------------|--------|--------|------------|
| `XF-OAC-ANT-001` | System prompt | Chat `{ role: 'system' }` | Anthropic `system[]` | Semantic equivalence |
| `XF-OAC-ANT-002` | User text | Chat string content | Anthropic array content | Same text |
| `XF-OAC-ANT-003` | Tool call arguments | Chat JSON string | Anthropic object | Parsed correctly |
| `XF-OAC-ANT-004` | Tool result | Chat `{ role: 'tool' }` | Anthropic `tool_result` in user | Same content |
| `XF-ANT-OAC-001` | Anthropic → Chat → Anthropic | Full conversation | Round-trip | Semantic preservation |
| `XF-ANT-OAC-002` | Cache control (lossy) | With cache_control | Without | Logged warning, no error |

### 2.2 OpenAI Chat ↔ Gemini

| Test ID | Description | Source | Target | Validation |
|---------|-------------|--------|--------|------------|
| `XF-OAC-GEM-001` | Role mapping | Chat `assistant` | Gemini `model` | Correct role |
| `XF-OAC-GEM-002` | Tool arguments | Chat JSON string | Gemini object | Parsed correctly |
| `XF-OAC-GEM-003` | System prompt | Chat `{ role: 'system' }` | Gemini `systemInstruction` | Preserved |
| `XF-GEM-OAC-001` | Thinking (lossy) | Gemini `thought: true` | Chat (dropped) | Logged warning |

### 2.3 OpenAI Chat ↔ OpenAI Responses

| Test ID | Description | Source | Target | Validation |
|---------|-------------|--------|--------|------------|
| `XF-OAC-OAR-001` | Text type | Chat `text` | Responses `input_text` | Type renamed |
| `XF-OAC-OAR-002` | System prompt | Chat `{ role: 'system' }` | Responses `instructions` | Moved to field |
| `XF-OAR-OAC-001` | Responses → Chat | Full request | Transformed | Semantic equivalence |

---

## 3. Streaming Tests

### 3.1 OpenAI Chat Streaming

| Test ID | Description | Input | Validation |
|---------|-------------|-------|------------|
| `OAC-STR-001` | Parse text delta | `delta: { content: 'Hello' }` | StreamChunk with text |
| `OAC-STR-002` | Parse role in first chunk | `delta: { role: 'assistant' }` | Role captured |
| `OAC-STR-003` | Parse tool call incremental | Multiple chunks with `tool_calls[index]` | Aggregated correctly |
| `OAC-STR-004` | Parse finish_reason | `finish_reason: 'stop'` | Stop reason mapped |
| `OAC-STR-005` | Parse usage in final chunk | `usage: { prompt_tokens, ... }` | Usage extracted |
| `OAC-STR-006` | Build streaming chunks | UnifiedStreamChunk → SSE | Valid SSE format |

### 3.2 Anthropic Streaming

| Test ID | Description | Input | Validation |
|---------|-------------|-------|------------|
| `ANT-STR-001` | Parse message_start | `{ type: 'message_start' }` | ID and model captured |
| `ANT-STR-002` | Parse content_block_start (text) | `content_block: { type: 'text' }` | Block initialized |
| `ANT-STR-003` | Parse content_block_start (tool_use) | `content_block: { type: 'tool_use', id, name }` | Tool call started |
| `ANT-STR-004` | Parse text_delta | `delta: { type: 'text_delta', text }` | Text accumulated |
| `ANT-STR-005` | Parse input_json_delta | `delta: { type: 'input_json_delta', partial_json }` | JSON accumulated |
| `ANT-STR-006` | Parse thinking_delta | `delta: { type: 'thinking_delta', thinking }` | Thinking accumulated |
| `ANT-STR-007` | Parse content_block_stop | `{ type: 'content_block_stop', index }` | Block finalized |
| `ANT-STR-008` | Parse message_delta | `delta: { stop_reason }` | Stop reason captured |
| `ANT-STR-009` | Build anthropic stream | UnifiedStreamChunk → Events | Valid event sequence |

### 3.3 Gemini Streaming

| Test ID | Description | Input | Validation |
|---------|-------------|-------|------------|
| `GEM-STR-001` | Parse incremental parts | Partial candidate content | Parts accumulated |
| `GEM-STR-002` | Parse function call | `functionCall` in parts | Tool call extracted |
| `GEM-STR-003` | Parse finish reason | `finishReason: 'STOP'` | Mapped to unified |
| `GEM-STR-004` | Parse usage metadata | `usageMetadata` in final chunk | Usage extracted |

---

## 4. Edge Case Tests

### 4.1 Error Handling

| Test ID | Description | Input | Expected |
|---------|-------------|-------|----------|
| `ERR-001` | Unknown model format | Provider cannot resolve format | Error: "Unsupported model" |
| `ERR-002` | Missing critical response field | Response without `id` | Error thrown |
| `ERR-003` | Invalid JSON in tool arguments | `arguments: '{invalid'` | Best-effort parse, log warning |
| `ERR-004` | Unsupported content type | Unknown `type` in parts | Strip + warning log |
| `ERR-005` | Stream parse failure mid-stream | Malformed chunk | Error chunk emitted, stream closed |

### 4.2 Lossy Transformations

| Test ID | Description | Source Feature | Target | Expected |
|---------|-------------|----------------|--------|----------|
| `LOSS-001` | Cache control to OpenAI | Anthropic cache_control | OpenAI Chat | Stripped, warning logged |
| `LOSS-002` | Thinking to OpenAI Chat | Anthropic thinking | OpenAI Chat | Stripped, warning logged |
| `LOSS-003` | Developer role to Anthropic | OpenAI developer | Anthropic | Converted to system |
| `LOSS-004` | File data to Chat | Gemini fileData | OpenAI Chat | Convert to base64 or error |

### 4.3 Boundary Conditions

| Test ID | Description | Input | Expected |
|---------|-------------|-------|----------|
| `BOUND-001` | Empty messages array | `messages: []` | Valid (edge case) or error |
| `BOUND-002` | Very long content | 100KB text | Passes through unmodified |
| `BOUND-003` | Many tool calls | 50+ tool calls | All preserved |
| `BOUND-004` | Deeply nested tool result | 3 levels of nested content | Structure preserved |
| `BOUND-005` | Unicode content | Emoji, CJK, RTL | Preserved correctly |
| `BOUND-006` | Binary image data | Large base64 image | Not corrupted |

---

## 5. Response Tests

### 5.1 Response Parsing

| Test ID | Description | Input | Validation |
|---------|-------------|-------|------------|
| `RESP-001` | OpenAI Chat response | Standard response | All fields mapped |
| `RESP-002` | OpenAI Chat with tool calls | `tool_calls` in response | Extracted to content |
| `RESP-003` | Anthropic response | Standard response | All fields mapped |
| `RESP-004` | Anthropic with thinking | `thinking` block | Extracted to separate array |
| `RESP-005` | Gemini response | Standard response | Role, usage mapped |
| `RESP-006` | Gemini safety block | `promptFeedback.blockReason` | Mapped to error |

### 5.2 Response Building

| Test ID | Description | Input | Validation |
|---------|-------------|-------|------------|
| `RESP-BUILD-001` | Build OpenAI Chat response | UnifiedResponse | Valid structure |
| `RESP-BUILD-002` | Build Anthropic response | UnifiedResponse | Valid structure |
| `RESP-BUILD-003` | Build Gemini response | UnifiedResponse | Valid structure |

---

## Test Fixtures Location

```
specs/018-provider-schema-refactor/
├── test-cases.md (this file)
└── fixtures/
    ├── openai-chat/
    │   ├── simple-request.json
    │   ├── multimodal-request.json
    │   ├── tool-calls-request.json
    │   └── streaming-chunks.jsonl
    ├── openai-responses/
    │   ├── simple-request.json
    │   └── function-call-request.json
    ├── anthropic/
    │   ├── simple-request.json
    │   ├── cache-control-request.json
    │   ├── thinking-response.json
    │   └── streaming-events.jsonl
    ├── gemini/
    │   ├── simple-request.json
    │   ├── function-call-request.json
    │   └── thinking-request.json
    └── unified/
        ├── simple-request.json
        └── complex-request.json
```

## Implementation Notes

1. **Test Framework**: Use Bun test (`bun:test`)
2. **Fixture Loading**: Create helper to load JSON fixtures
3. **Comparison**: Use deep equality with custom comparator for semantic equivalence
4. **Logging Verification**: Mock logger to verify warnings are logged for lossy transforms
5. **Streaming Tests**: Use async iterators or mock SSE streams
