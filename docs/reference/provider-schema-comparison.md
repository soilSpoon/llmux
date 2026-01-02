# Provider Schema Comparison Analysis

**Created:** 2025-12-24  
**Sources:** litellm, opencode, opencode-antigravity-auth, opencode-google-antigravity-auth

---

## 1. Project Schema Usage

| Project | Language | Main Role | Supported Providers |
|---------|----------|-----------|--------------------|
| **litellm** | Python | 100+ Provider Unified Proxy | OpenAI, Anthropic, Gemini, Vertex AI, Bedrock, Azure, etc. |
| **opencode** | TypeScript | AI Coding Agent | Anthropic, OpenAI, Google, Mistral, Bedrock, etc. |
| **opencode-antigravity-auth** | TypeScript | Antigravity Plugin | Claude, Gemini via Antigravity Gateway |
| **opencode-google-antigravity-auth** | TypeScript | Google Antigravity Plugin | Claude, Gemini via Antigravity Gateway |

---

## 2. Request Schema Comparison

### 2.1 Message Structure

| Item | OpenAI | Anthropic/Claude | Gemini | Antigravity |
|------|--------|------------------|--------|-------------|
| **Container** | `messages[]` | `messages[]` | `contents[]` | `request.contents[]` |
| **Roles** | `system`, `user`, `assistant`, `tool`, `developer` | `user`, `assistant` (system separate) | `user`, `model` | `user`, `model` |
| **Content Fields** | `content` (string or array) | `content` (array of blocks) | `parts[]` | `parts[]` |

### 2.2 System Instructions

| Provider | Format | Example |
|----------|--------|---------|
| **OpenAI** | First `system` role message | `{role: "system", content: "..."}` |
| **Anthropic** | Separate `system` field | `{system: "..."}` or `{system: [{type: "text", text: "..."}]}` |
| **Gemini** | `systemInstruction` object | `{systemInstruction: {parts: [{text: "..."}]}}` ⚠️ string not allowed |
| **Antigravity** | Gemini style | `{request: {systemInstruction: {parts: [...]}}}` |

### 2.3 Content Block/Part Types

| Type | OpenAI | Anthropic | Gemini | Antigravity |
|------|--------|-----------|--------|-------------|
| **Text** | `{type: "text", text}` | `{type: "text", text}` | `{text: "..."}` | `{text: "..."}` |
| **Image** | `{type: "image_url", image_url: {url}}` | `{type: "image", source: {type, data, media_type}}` | `{inlineData: {mimeType, data}}` | Same |
| **Tool Call** | `tool_calls[]` in message | `{type: "tool_use", id, name, input}` | `{functionCall: {name, args, id}}` | Same |
| **Tool Result** | `{role: "tool", content, tool_call_id}` | `{type: "tool_result", tool_use_id, content}` | `{functionResponse: {name, id, response}}` | Same |
| **Thinking** | `reasoning_content` (some models) | `{type: "thinking", thinking, signature}` | `{thought: true, text, thoughtSignature}` | Same |

---

## 3. Tool/Function Definition Comparison

### 3.1 Structure

| Provider | Location | Structure |
|----------|----------|-----------|
| **OpenAI** | `tools[]` | `{type: "function", function: {name, description, parameters}}` |
| **Anthropic** | `tools[]` | `{name, description, input_schema}` + built-in tools |
| **Gemini** | `tools[].functionDeclarations[]` | `{name, description, parameters}` |
| **Antigravity** | `request.tools[]` | Gemini style (clean schema required) |

### 3.2 Schema Support

| JSON Schema Feature | OpenAI | Anthropic | Gemini | Antigravity |
|-------------------|--------|-----------|--------|-------------|
| `type`, `properties` | ✅ | ✅ | ✅ | ✅ |
| `required` | ✅ | ✅ | ✅ | ✅ |
| `enum` | ✅ | ✅ | ✅ | ✅ |
| `const` | ✅ | ✅ | ❌ | ❌ → Convert to `enum: [value]` |
| `$ref`, `$defs` | ✅ | ✅ | ❌ | ❌ → Must inline |
| `anyOf`, `oneOf` | ✅ | ✅ | ✅ → `any_of` | ✅ |
| `default`, `examples` | ✅ | ✅ | ❌ | ❌ → Remove |

### 3.3 Tool Naming Rules

| Rule | OpenAI | Anthropic | Gemini/Antigravity |
|------|--------|-----------|-------------------|
| First char | Flexible | Flexible | Letter or `_` required |
| Allowed chars | Most | Most | `a-zA-Z0-9_.-:` |
| Forbidden chars | - | - | `/`, Space |
| Max length | - | - | 64 chars |

---

## 4. Generation Config Comparison

| Parameter | OpenAI | Anthropic | Gemini | Antigravity |
|-----------|--------|-----------|--------|-------------|
| **Max Tokens** | `max_tokens` | `max_tokens` (required) | `maxOutputTokens` | `maxOutputTokens` |
| **Temperature** | `temperature` | `temperature` | `temperature` | `temperature` |
| **Top P** | `top_p` | `top_p` | `topP` | `topP` |
| **Top K** | ❌ | `top_k` | `topK` | `topK` |
| **Stop** | `stop` (array) | `stop_sequences` | `stopSequences` | `stopSequences` |
| **Thinking** | `reasoning_effort` | `thinking: {budget_tokens}` | `thinkingConfig: {thinkingBudget}` | `thinkingConfig` |

---

## 5. Response Schema Comparison

### 5.1 Top-level Structure

| Provider | Structure |
|----------|-----------|
| **OpenAI** | `{id, object, choices[], usage}` |
| **Anthropic** | `{id, type: "message", role, content[], stop_reason, usage}` |
| **Gemini** | `{candidates[], usageMetadata, modelVersion, responseId}` |
| **Antigravity** | `{response: {candidates[], ...}, traceId}` → Plugin unwraps `response` |

### 5.2 Finish Reasons

| Reason | OpenAI | Anthropic | Gemini |
|--------|--------|-----------|--------|
| Normal Stop | `stop` | `end_turn` | `STOP` |
| Token Limit | `length` | `max_tokens` | `MAX_TOKENS` |
| Tool Use | `tool_calls` | `tool_use` | `OTHER` |
| Safety Filter | `content_filter` | - | `SAFETY` |

### 5.3 Usage Fields

| Field | OpenAI | Anthropic | Gemini |
|-------|--------|-----------|--------|
| Input Tokens | `prompt_tokens` | `input_tokens` | `promptTokenCount` |
| Output Tokens | `completion_tokens` | `output_tokens` | `candidatesTokenCount` |
| Thinking Tokens | - | (included in usage) | `thoughtsTokenCount` |
| Cache Tokens | `cached_tokens` | `cache_creation_input_tokens`, `cache_read_input_tokens` | `cachedContentTokenCount` |

---

## 6. Streaming Format Comparison

### 6.1 Event Types

| Provider | Format | Event |
|----------|--------|-------|
| **OpenAI** | SSE | `data: {choices: [{delta: {...}}]}` |
| **Anthropic** | SSE | `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` |
| **Gemini** | SSE | `data: {candidates: [...], usageMetadata: {...}}` |
| **Antigravity** | SSE | `data: {response: {...}}` → Plugin unwraps |

### 6.2 Delta Structure

```jsonc
// OpenAI
{"choices": [{"delta": {"content": "Hello"}}]}
{"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "..."}}]}}]}

// Anthropic
{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}
{"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": "..."}}

// Gemini
{"candidates": [{"content": {"parts": [{"text": "Hello"}]}}]}
{"candidates": [{"content": {"parts": [{"functionCall": {...}}]}}]}
```

---

## 7. Thinking/Reasoning Handling

### 7.1 Request Configuration

| Provider | Activation | Parameter |
|----------|------------|-----------|
| **OpenAI** | `reasoning_effort` | `"low"`, `"medium"`, `"high"` |
| **Anthropic** | `thinking` object | `{type: "enabled", budget_tokens: N}` |
| **Gemini** | `thinkingConfig` | `{thinkingBudget: N, includeThoughts: true}` or `{thinkingLevel: "high"}` |
| **Antigravity (Claude)** | `thinkingConfig` | `{include_thoughts: true, thinking_budget: N}` (snake_case) |

### 7.2 Response Format

| Provider | Thinking Block Structure |
|----------|--------------------------|
| **OpenAI** | `reasoning_content` field (some models) |
| **Anthropic** | `{type: "thinking", thinking: "...", signature: "..."}` |
| **Gemini** | `{thought: true, text: "...", thoughtSignature: "..."}` |

### 7.3 Signature Handling (Multi-turn)

| Item | Description |
|------|-------------|
| **Issue** | Claude rejects unsigned thinking blocks in multi-turn conversations |
| **Solution** | Plugin caches signatures and restores them in subsequent requests |
| **Cache Key** | `hash(sessionId + model + text)` |
| **TTL** | 1 hour, max 100 per session |

---

## 8. Transformation Patterns by Project

### 8.1 litellm (Python)

```python
class BaseConfig(ABC):
    def get_supported_openai_params(model: str) -> list
    def map_openai_params(params, model) -> dict  # OpenAI → Provider
    def transform_request(model, messages, params) -> dict
    def transform_response(raw_response, model_response) -> ModelResponse
```

**Features:**
- Uses OpenAI format as "standard"
- Config classes per provider handle transformation
- Unifies Usage into OpenAI style

### 8.2 opencode (TypeScript)

```typescript
namespace ProviderTransform {
    message(model, messages): ModelMessage[]  // ID normalization, handle unsupported parts
    options(model): LanguageModelV1CallOptions  // Provider-specific options
    schema(model, schema): JSONSchema  // Enum normalization
    applyCaching(model, messages): ModelMessage[]  // Cache control
}
```

**Features:**
- Uses AI SDK `LanguageModelV2` interface
- Pre-normalizes provider quirks
- Moves `reasoning` part to `reasoning_content`

### 8.3 opencode-antigravity-auth (TypeScript)

```typescript
prepareAntigravityRequest(url, body, headers)
  → {url, body: {project, model, request, ...}, headers}

transformAntigravityResponse(response, streaming)
  → unwrapped response, cached signatures
```

**Features:**
- Wraps Gemini-style API with Antigravity wrapper
- Enforces `toolConfig.mode = "VALIDATED"` for Claude models
- Thinking signature caching/restoration

### 8.4 opencode-google-antigravity-auth (TypeScript)

```typescript
transformClaudeRequest(context, body)
  → Claude specific transform (snake_case thinkingConfig, schema normalization)

transformGeminiRequest(context, body)
  → Gemini specific transform (inject system hints, sanitize tool names)
```

**Features:**
- Branches by model family (`isClaudeModel`)
- Tool schema caching and response normalization
- Removes artifacts from conversation history

---

## 9. Testing Strategy

### 9.1 Unit Tests (Transformation Functions)

| Test Target | Verification Item |
|-------------|-------------------|
| **Message Transform** | Role mapping, content structure conversion |
| **System Instruction** | String → Object conversion |
| **Tool Schema** | `const` → `enum`, `$ref` inlining |
| **Thinking Config** | Auto-adjustment of budget/limit |

```go
// Example: Go unit test
func TestOpenAIToGeminiMessages(t *testing.T) {
    input := OpenAIRequest{
        Messages: []Message{{Role: "assistant", Content: "Hello"}},
    }
    expected := GeminiRequest{
        Contents: []Content{{Role: "model", Parts: []Part{{Text: "Hello"}}}},
    }
    result := TransformOpenAIToGemini(input)
    assert.Equal(t, expected, result)
}
```

### 9.2 Integration Tests (Mock Server)

```go
// Example: Round-trip test with Mock server
func TestRoundTrip(t *testing.T) {
    // 1. Create OpenAI format request
    openaiReq := createTestOpenAIRequest()
    
    // 2. Transform to Gemini
    geminiReq := Transform(openaiReq, "gemini")
    
    // 3. Send to Mock Gemini Server
    geminiResp := mockGeminiServer.Handle(geminiReq)
    
    // 4. Transform back to OpenAI
    openaiResp := TransformResponse(geminiResp, "openai")
    
    // 5. Verify
    assert.NotEmpty(t, openaiResp.Choices)
}
```

### 9.3 Streaming Tests

```go
func TestStreamingTransform(t *testing.T) {
    // SSE chunk sequence
    chunks := []string{
        `data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}`,
        `data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}`,
    }
    
    var result strings.Builder
    for _, chunk := range chunks {
        transformed := TransformStreamChunk(chunk, "openai")
        // {"choices":[{"delta":{"content":"Hel"}}]}
        result.WriteString(extractContent(transformed))
    }
    
    assert.Equal(t, "Hello", result.String())
}
```

### 9.4 Thinking Signature Tests

```go
func TestThinkingSignatureCache(t *testing.T) {
    // 1. First request: thinking block + signature response
    resp1 := simulateResponse(withThinking("Let me think...", "sig123"))
    CacheSignatures(resp1)
    
    // 2. Second request: thinking block without signature
    req2 := createRequest(withThinking("Let me think...", ""))
    restored := RestoreSignatures(req2)
    
    // 3. Verify signature restored
    assert.Equal(t, "sig123", restored.ThinkingSignature)
}
```

### 9.5 End-to-End API Tests

```bash
# Set environment variables
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...

# Start proxy server
go run ./cmd/server

# Test transformation with curl
curl http://localhost:8743/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: gemini" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## 10. Related Documentation

- [openai-chat-completions-schema.md](./openai-chat-completions-schema.md)
- [anthropic-api-schema.md](./anthropic-api-schema.md)
- [gemini-api-schema.md](../schemas/gemini-api-schema.md)
- [antigravity-api-schema.md](./antigravity-api-schema.md)
- [ANTIGRAVITY_API_SPEC.md](../../opencode-antigravity-auth/docs/ANTIGRAVITY_API_SPEC.md)
- [CLAUDE_MODEL_FLOW.md](../../opencode-antigravity-auth/docs/CLAUDE_MODEL_FLOW.md)
