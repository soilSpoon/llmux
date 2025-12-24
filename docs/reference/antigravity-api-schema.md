# Antigravity API Wrapper Schema Analysis

Analysis of the Antigravity API wrapper patterns from:
- `opencode-antigravity-auth` 
- `opencode-google-antigravity-auth`

---

## 1. Request Wrapper Structure

### Wrapped Request Format
```json
{
  "project": "<project-id>",
  "model": "<effective-model-name>",
  "userAgent": "antigravity",
  "requestId": "agent-<uuid>",
  "request": {
    "contents": [...],
    "generationConfig": {...},
    "tools": [...],
    "toolConfig": {...},
    "systemInstruction": {...},
    "sessionId": "<session-id>"
  }
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `project` | string | GCP project ID (e.g., `rising-fact-p41fc`) |
| `model` | string | Effective model name after alias resolution |
| `userAgent` | string | Always `"antigravity"` |
| `requestId` | string | Format: `agent-<uuid>` |
| `request` | object | Inner Gemini-style request payload |
| `request.sessionId` | string | Session identifier for signature caching |

### Inner Request (Gemini Format)
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "..." }]
    },
    {
      "role": "model",
      "parts": [
        { "thought": true, "text": "...", "thoughtSignature": "..." },
        { "functionCall": { "name": "...", "args": {...}, "id": "..." } }
      ]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 64000,
    "thinkingConfig": {
      "include_thoughts": true,
      "thinking_budget": 16384
    }
  },
  "tools": [
    {
      "functionDeclarations": [
        {
          "name": "tool_name",
          "description": "...",
          "parameters": {
            "type": "object",
            "properties": {...},
            "required": [...]
          }
        }
      ]
    }
  ],
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "VALIDATED"
    }
  },
  "systemInstruction": {
    "parts": [{ "text": "..." }]
  }
}
```

---

## 2. Required Headers

### Antigravity Style
```typescript
const ANTIGRAVITY_HEADERS = {
  "User-Agent": "antigravity/1.11.5 windows/amd64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
};
```

### Gemini CLI Style (Alternative)
```typescript
const GEMINI_CLI_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
};
```

### Authorization
```http
Authorization: Bearer <access-token>
Content-Type: application/json
Accept: text/event-stream  # For streaming requests
```

### Special Headers
```http
# For Claude thinking models
anthropic-beta: interleaved-thinking-2025-05-14
```

---

## 3. Response Wrapper Structure

### Non-Streaming Response
```json
{
  "response": {
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": [
            { "thought": true, "text": "thinking content", "thoughtSignature": "base64..." },
            { "text": "response text" },
            {
              "functionCall": {
                "name": "tool_name",
                "args": {...},
                "id": "tool-call-1"
              },
              "thoughtSignature": "base64..."
            }
          ]
        },
        "finishReason": "STOP",
        "groundingMetadata": {...}
      }
    ],
    "usageMetadata": {
      "promptTokenCount": 1000,
      "candidatesTokenCount": 500,
      "totalTokenCount": 1500,
      "cachedContentTokenCount": 200
    }
  },
  "traceId": "optional-trace-id"
}
```

### Streaming SSE Response
```
data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"..."}]}}]}}

data: {"response":{"candidates":[{"content":{"parts":[{"text":"..."}]}}]}}

data: {"response":{"candidates":[{"finishReason":"STOP","content":{"parts":[]}}],"usageMetadata":{...}}}
```

### Response Transformation
The wrapper extracts `response` from the Antigravity envelope:
```typescript
if (effectiveBody?.response !== undefined) {
  return new Response(JSON.stringify(effectiveBody.response), init);
}
```

---

## 4. Model Aliases & Routing

### Model Alias Map
```typescript
const MODEL_ALIASES: Record<string, string> = {
  "gemini-2.5-computer-use-preview-10-2025": "rev19-uic3-1p",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-3-pro-preview": "gemini-3-pro-high",
  "gemini-claude-sonnet-4-5": "claude-sonnet-4-5",
  "gemini-claude-sonnet-4-5-thinking": "claude-sonnet-4-5-thinking",
  "gemini-claude-opus-4-5-thinking": "claude-opus-4-5-thinking",
};
```

### Model Family Detection
```typescript
function getModelFamily(model: string): ModelFamily {
  if (model.includes("claude")) return "claude";
  if (model.includes("flash")) return "gemini-flash";
  return "gemini-pro";
}
```

### Claude vs Gemini Routing
- Models containing `"claude"` → Use Claude transformer
- All others → Use Gemini transformer

---

## 5. Special Handling

### toolConfig.functionCallingConfig.mode = "VALIDATED"
Both Claude and Gemini transformers enforce this:
```typescript
if (typeof requestPayload.toolConfig === "object") {
  const toolConfig = requestPayload.toolConfig as Record<string, unknown>;
  if (!toolConfig.functionCallingConfig) {
    toolConfig.functionCallingConfig = {};
  }
  (toolConfig.functionCallingConfig as Record<string, unknown>).mode = "VALIDATED";
}
```

### thinkingConfig Normalization

For Claude thinking models (`*-thinking`):
```typescript
const thinkingConfig = {
  include_thoughts: true,
  thinking_budget: 16384,  // Default 16k tokens
};

// Also set maxOutputTokens >= thinking_budget
generationConfig.maxOutputTokens = 64000;
```

For Gemini models:
```typescript
// Uses camelCase normalization
const normalizedThinking = {
  includeThoughts: true,
  thinkingBudget: 16000,
};
```

### Thinking Signature Handling
Claude requires signed thinking blocks. The plugins:
1. Cache signatures from responses: `cacheSignature(family, sessionId, text, signature)`
2. Restore signatures on subsequent requests: `getCachedSignature(family, sessionId, text)`
3. Remove unsigned thinking blocks from multi-turn requests
4. For functionCall parts without signatures, use `"skip_thought_signature_validator"`

### Tool Schema Transformation (Claude)
```typescript
// Claude expects: parameters with type: "object"
// AI SDK sends: parametersJsonSchema
funcDecl.parameters = funcDecl.parametersJsonSchema;
delete funcDecl.parametersJsonSchema;
delete params["$schema"];

if (!params.type) params.type = "object";
if (!params.properties) params.properties = {};
```

### functionCall ID Assignment
```typescript
// Claude requires IDs on functionCall/functionResponse pairs
if (!functionCall.id) {
  functionCall.id = `${functionCall.name}-${randomUUID()}`;
}

// Match functionResponse to functionCall using FIFO queue
if (!functionResponse.id) {
  functionResponse.id = pendingCallIdsByName.get(functionResponse.name)?.shift();
}
```

---

## 6. Endpoint Fallback

### Endpoint URLs
```typescript
const CODE_ASSIST_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const CODE_ASSIST_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
const CODE_ASSIST_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";
```

### Fallback Order
```typescript
const CODE_ASSIST_ENDPOINT_FALLBACKS = [
  CODE_ASSIST_ENDPOINT_DAILY,    // Try first
  CODE_ASSIST_ENDPOINT_AUTOPUSH, // Fallback 1
  CODE_ASSIST_ENDPOINT_PROD,     // Final fallback
];
```

### Retry Conditions
- **403/404**: Try next endpoint
- **500+**: Try next endpoint, switch account if all fail
- **429**: Parse retry-after, switch accounts with backoff

---

## 7. API Endpoint Format

### Request URL Transformation
```typescript
// Original: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent
// Transformed: https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse

const transformedUrl = `${CODE_ASSIST_ENDPOINT}/v1internal:${rawAction}${streaming ? "?alt=sse" : ""}`;
```

### Actions
- `:generateContent` - Non-streaming
- `:streamGenerateContent` - Streaming (add `?alt=sse`)

---

## 8. Example: Complete Claude Request

```json
{
  "project": "rising-fact-p41fc",
  "model": "claude-sonnet-4-5-thinking",
  "userAgent": "antigravity",
  "requestId": "agent-550e8400-e29b-41d4-a716-446655440000",
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "Write a function to sort an array" }]
      }
    ],
    "generationConfig": {
      "maxOutputTokens": 64000,
      "thinkingConfig": {
        "include_thoughts": true,
        "thinking_budget": 16384
      }
    },
    "tools": [
      {
        "functionDeclarations": [
          {
            "name": "write_file",
            "description": "Write content to a file",
            "parameters": {
              "type": "object",
              "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
              },
              "required": ["path", "content"]
            }
          }
        ]
      }
    ],
    "toolConfig": {
      "functionCallingConfig": {
        "mode": "VALIDATED"
      }
    },
    "sessionId": "-550e8400-e29b-41d4-a716-446655440001:claude-sonnet-4-5-thinking:seed-abc123:default"
  }
}
```

---

## 9. Example: Complete Response

```json
{
  "response": {
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": [
            {
              "thought": true,
              "text": "I need to write a sorting function. Let me consider different approaches...",
              "thoughtSignature": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            },
            {
              "text": "Here's a quicksort implementation:\n\n```python\ndef quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + middle + quicksort(right)\n```"
            }
          ]
        },
        "finishReason": "STOP"
      }
    ],
    "usageMetadata": {
      "promptTokenCount": 50,
      "candidatesTokenCount": 200,
      "totalTokenCount": 250
    }
  }
}
```

---

## 10. OAuth & Authentication

### OAuth Scopes
```typescript
const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];
```

### Token Refresh
- Access tokens expire (check `accessTokenExpired()`)
- Refresh using stored refresh token
- Support for multi-account rotation on rate limits
