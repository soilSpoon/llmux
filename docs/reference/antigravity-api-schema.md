# Antigravity API Schema

**Endpoint:** `cloudcode-pa.googleapis.com` (Production)
**Format:** Gemini-style JSON

## 1. Request Body

The request must be wrapped in a specific envelope containing authentication and project metadata.

```json
{
  "project": "string",          // Google Cloud Project ID
  "model": "string",            // Model ID (e.g. "claude-sonnet-4-5")
  "userAgent": "antigravity",   // Fixed string
  "requestId": "string",        // Unique UUID
  "request": {
    // Gemini-style Inner Request
    "contents": [
      {
        "role": "user" | "model",
        "parts": [
          { "text": "string" },
          { "thought": boolean, "text": "string", "thoughtSignature": "string" },
          { "functionCall": { "name": "string", "args": object, "id": "string" } },
          { "functionResponse": { "name": "string", "response": object, "id": "string" } }
        ]
      }
    ],
    "systemInstruction": {
      "parts": [{ "text": "string" }]
    },
    "tools": [
      {
        "functionDeclarations": [
          {
            "name": "string",
            "description": "string",
            "parameters": {
              "type": "object",
              "properties": { ... },
              "required": ["..."]
            }
          }
        ]
      }
    ],
    "toolConfig": {
      "functionCallingConfig": {
        "mode": "AUTO" | "ANY" | "NONE" | "VALIDATED",
        "allowedFunctionNames": ["string"]
      }
    },
    "generationConfig": {
      "maxOutputTokens": integer,
      "temperature": float,
      "topP": float,
      "topK": integer,
      "stopSequences": ["string"],
      "thinkingConfig": {
        "includeThoughts": boolean,
        "thinkingBudget": integer
      }
    }
  }
}
```

## 2. Important Constraints

| Component | Constraint |
|-----------|------------|
| **System Instructions** | MUST be an object `{ parts: [...] }`. Plain strings cause 400 errors. |
| **Roles** | Only `user` and `model` are allowed. `assistant` is NOT supported. |
| **JSON Schema** | `const`, `$ref`, `$defs`, `default`, `examples` are **NOT** supported. |
| **Tool Names** | Regex: `^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$`. No slashes allowed. |
| **Thinking** | `maxOutputTokens` must be greater than `thinkingBudget`. |

## 3. Response Format

### Standard Response

```json
{
  "response": {
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": [
            { "text": "Response text..." }
          ]
        },
        "finishReason": "STOP",
        "usageMetadata": {
          "promptTokenCount": integer,
          "candidatesTokenCount": integer,
          "totalTokenCount": integer
        }
      }
    ]
  }
}
```

### Streaming Response (SSE)

Events are sent as `data` lines containing the JSON response wrapper.

```json
data: {"response": {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}}
```

## 4. Headers

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <oauth_token>` |
| `Content-Type` | `application/json` |
| `User-Agent` | `antigravity/1.11.5 windows/amd64` |
| `x-quota-project` | `<project_id>` |
| `Accept` | `text/event-stream` (for streaming) |
