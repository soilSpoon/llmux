# llmux Server Endpoints

Complete reference for all llmux server endpoints with examples and use cases.

## Quick Reference

| Endpoint | Format | Default Target | Use Case |
|----------|--------|---|----------|
| `/v1/chat/completions` | OpenAI (auto) | `openai` | OpenAI SDK compatibility |
| `/v1/messages` | Anthropic (enforced) | `anthropic` | Anthropic SDK compatibility |
| `/messages` | Anthropic (enforced) | `anthropic` | Alias (version-less path) |
| `/v1/generateContent` | Gemini (auto) | `gemini` | Gemini API compatibility |
| `/v1/auto` | Auto-detect | Detected | Generic routing (all formats) |
| `/v1/proxy` | Auto-detect | Via header (required) | Explicit provider control |
| `/v1/responses` | OpenAI | `openai` | OpenAI Responses API format |

## Common Headers

All endpoints support these optional headers:

| Header | Purpose | Example |
|--------|---------|---------|
| `X-Target-Provider` | Override target provider | `X-Target-Provider: antigravity` |
| `X-Target-Model` | Override model name | `X-Target-Model: claude-3-5-sonnet` |
| `X-API-Key` | Provide API key | `X-API-Key: sk-proj-...` |

## Format Detection Rules

The system auto-detects request format based on request body structure:

```javascript
// Anthropic: Has 'messages' AND 'system' field
{ messages: [...], system: "..." } → format: 'anthropic'

// OpenAI: Has 'messages' AND 'model' (no 'system')
{ model: "gpt-4", messages: [...] } → format: 'openai'

// Gemini: Has 'contents' array
{ contents: [{ role: "user", parts: [...] }] } → format: 'gemini'

// Antigravity: Has 'payload.contents'
{ payload: { contents: [...] } } → format: 'antigravity'
```

## Provider Endpoints

### 1. `/v1/chat/completions` - OpenAI SDK Compatibility

OpenAI SDK endpoint. Auto-detects request format, routes to configured provider.

**Default Behavior**:
- Input format: Auto-detected (OpenAI, Anthropic, Gemini, Antigravity)
- Target provider: `openai` (configurable)
- Supports: Streaming, model mapping, custom API keys

**Example: OpenAI SDK to Anthropic**

```bash
curl -X POST http://localhost:8743/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: anthropic" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

**Example: JavaScript**

```typescript
import { createOpenAI } from "@ai-sdk/openai";

// Use OpenAI SDK to call Anthropic through llmux
const llmux = createOpenAI({
  baseURL: "http://localhost:8743/v1",
  apiKey: "dummy",
  headers: {
    "X-Target-Provider": "anthropic",
  },
});

const result = await generateText({
  model: llmux("gpt-4"), // Model name sent to Anthropic
  prompt: "Hello",
});
```

---

### 2. `/v1/messages` & `/messages` - Anthropic SDK Compatibility

Anthropic API endpoints. Enforces Anthropic format input.

**Behavior**:
- Input format: Anthropic (enforced - must have `messages` and optionally `system`)
- Default target: `anthropic`
- Can override target via `X-Target-Provider` header
- Supports: Streaming, model mapping, OAuth credentials

**Example: Anthropic SDK**

```bash
curl -X POST http://localhost:8743/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}],
    "system": "You are a helpful assistant."
  }'
```

**Example: JavaScript with @ai-sdk/anthropic**

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({
  baseURL: "http://localhost:8743",
  apiKey: "dummy", // Not used by llmux OAuth
});

const result = await generateText({
  model: anthropic("claude-3-5-sonnet-20241022"),
  prompt: "Hello",
});
```

**To route to different provider**:

```bash
curl -X POST http://localhost:8743/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: gemini" \
  -d '{
    "model": "claude-3",
    "messages": [{"role": "user", "content": "Hello"}],
    "system": "You are helpful.",
    "stream": false
  }'
```

---

### 3. `/v1/generateContent` - Gemini API Compatibility

Google Gemini endpoint. Auto-detects Gemini format from request body.

**Behavior**:
- Input format: Gemini (auto-detected - requires `contents` array)
- Default target: `gemini`
- Can override target via `X-Target-Provider` header

**Example: Gemini Format**

```bash
curl -X POST http://localhost:8743/v1/generateContent \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-pro",
    "contents": [{
      "role": "user",
      "parts": [{"text": "Hello"}]
    }]
  }'
```

---

## Flexible Routing Endpoints

### 4. `/v1/auto` - Universal Auto-Detection

Generic proxy that auto-detects format and routes to matching provider.

**Behavior**:
- Input format: Auto-detected from request body
- Default target: Matches detected format (can override with `X-Target-Provider`)
- Supports: All formats and providers
- Use case: When format is unknown at client time

**Example: Auto-detect and route**

```bash
# Send OpenAI format, automatically route to openai
curl -X POST http://localhost:8743/v1/auto \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Same request, but override to Anthropic
curl -X POST http://localhost:8743/v1/auto \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: anthropic" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

### 5. `/v1/proxy` - Explicit Provider Routing

Explicit routing endpoint. Requires `X-Target-Provider` header.

**Behavior**:
- Input format: Auto-detected
- Target provider: **Required** via `X-Target-Provider` header
- Returns 400 if header missing
- Use case: When you need explicit control

**Example: Must specify provider**

```bash
curl -X POST http://localhost:8743/v1/proxy \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: antigravity" \
  -d '{
    "model": "gemini-3-pro-high",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Missing header returns 400
curl -X POST http://localhost:8743/v1/proxy \
  -H "Content-Type: application/json" \
  -d '{ ... }'
# {"error": "X-Target-Provider header required"}
```

---

### 6. `/v1/responses` - OpenAI Responses API

Unified endpoint that normalizes all responses to OpenAI Responses API format.

**Behavior**:
- Input format: OpenAI (standard chat completions request)
- Output format: OpenAI Responses API (structured with reasoning, etc.)
- Default target: `openai`
- Auto-detects provider from model name if needed
- Special handling for streaming transformation

**Example: Get OpenAI Responses API format**

```bash
curl -X POST http://localhost:8743/v1/responses \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: anthropic" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Explain recursion"}],
    "stream": false
  }'
```

**Example: Streaming to OpenAI Responses API format**

```bash
curl -X POST http://localhost:8743/v1/responses \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: gemini" \
  -d '{
    "model": "gemini-3-pro-high",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

Response is SSE stream in OpenAI Responses API format:

```
event: content_block_start
data: {"type":"content_block_start","content_block":{"type":"text"}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop"}

event: message_stop
data: {"type":"message_stop"}
```

---

## Utility Endpoints

### Health Check
```bash
GET /health
```

### List Registered Providers
```bash
GET /providers
```

### List Available Models
```bash
GET /models
```

---

## Authentication Methods

### 1. OAuth (via AuthProviderRegistry)

For providers like Antigravity that support OAuth:

```bash
curl -X POST http://localhost:8743/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3",
    "messages": [...],
    "stream": false
  }'
# Credentials automatically retrieved from CredentialStorage
```

### 2. API Key (via X-API-Key header)

```bash
curl -X POST http://localhost:8743/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: openai" \
  -H "X-API-Key: sk-proj-..." \
  -d '{ ... }'
```

### 3. Dummy (for OAuth providers)

```bash
curl -X POST http://localhost:8743/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3",
    "messages": [...],
    "stream": false
  }'
# X-API-Key missing or "dummy" → uses OAuth credentials
```

---

## Streaming

All endpoints support streaming via `"stream": true` in request body.

Response headers for streaming:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Example: Streaming**

```bash
curl -X POST http://localhost:8743/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: anthropic" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'

# Response (SSE stream):
# data: {"choices":[{"delta":{"content":"Hello"}}]}
# data: [DONE]
```

---

## Model Mapping

Endpoints support model mapping via server configuration (modelMappings array).

**Configuration Example**:

```typescript
const server = await startServer({
  port: 8743,
  amp: {
    handlers: { /* ... */ },
    modelMappings: [
      { from: "gpt-4", to: "claude-3-5-sonnet-20241022" },
      { from: "gpt-4-turbo", to: ["claude-3-opus-20240229", "claude-3-sonnet-20240229"] },
    ],
  },
});
```

**Usage**:

```bash
curl -X POST http://localhost:8743/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: anthropic" \
  -d '{
    "model": "gpt-4",  # Mapped to claude-3-5-sonnet-20241022
    "messages": [...]
  }'
```

Can also override with `X-Target-Model` header:

```bash
-H "X-Target-Model: claude-3-opus-20240229"
```

---

## Retry & Rate Limiting

**Provider-specific retries** (non-streaming, non-responses):
- Max attempts: 5
- Retry on 429 (rate limit)
- Exponential backoff: 2^(attempt-1) seconds (max 16 seconds)
- Automatic credential rotation for OAuth providers

**Example: 429 handling**

```bash
# Request hits 429 rate limit
curl -X POST http://localhost:8743/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: openai" \
  -d '{ ... }'

# Server automatically retries with backoff
# 1st retry: ~1 second delay
# 2nd retry: ~2 seconds delay
# 3rd retry: ~4 seconds delay
# etc.
```

---

## Error Responses

All endpoints return JSON error responses:

```json
{
  "error": "Invalid provider: xyz"
}
```

Common error codes:

| Status | Message |
|--------|---------|
| 400 | Invalid format, missing required headers, invalid provider |
| 401 | No credentials found for provider |
| 402 | Rate limit / insufficient credits |
| 502 | Network error or upstream service error |
| 500 | Internal server error |

---

## TypeScript Examples

### Using with Vercel AI SDK

```typescript
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, streamText } from 'ai'

// Route OpenAI requests to Anthropic
const llmux = createOpenAI({
  baseURL: 'http://localhost:8743/v1',
  apiKey: 'dummy',
  headers: { 'X-Target-Provider': 'anthropic' },
})

// Non-streaming
const result = await generateText({
  model: llmux('gpt-4'),
  prompt: 'Hello',
})

// Streaming
const stream = await streamText({
  model: llmux('gpt-4'),
  prompt: 'Hello',
})

for await (const chunk of stream.textStream) {
  console.log(chunk)
}
```

### Using with Anthropic SDK

```typescript
import { createAnthropic } from '@ai-sdk/anthropic'

const anthropic = createAnthropic({
  baseURL: 'http://localhost:8743',
  apiKey: 'dummy',
})

const result = await generateText({
  model: anthropic('claude-3-5-sonnet-20241022'),
  prompt: 'Hello',
})
```

---

## Decision Tree: Which Endpoint?

```
Do you know the input format?
├─ Yes, it's OpenAI → Use /v1/chat/completions
├─ Yes, it's Anthropic → Use /v1/messages or /messages
├─ Yes, it's Gemini → Use /v1/generateContent
└─ No → Use /v1/auto (or /v1/proxy if using header-based routing)

Do you need OpenAI Responses API output?
└─ Yes → Use /v1/responses (input: OpenAI format, output: normalized)

Do you need explicit control over routing?
└─ Yes → Use /v1/proxy (requires X-Target-Provider header)

Using an SDK from a specific provider?
├─ OpenAI SDK → Point to /v1/chat/completions
├─ Anthropic SDK → Point to /v1/messages or /messages
└─ Other → Use /v1/auto or /v1/proxy
```
