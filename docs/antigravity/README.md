# Antigravity Support

## Overview

Antigravity is Google's **Unified Gateway API** (`cloudcode-pa.googleapis.com`) that provides access to multiple AI models (Claude, Gemini, GPT-OSS) through a single, consistent Gemini-style interface.

> **Note**: This is distinct from Vertex AI or public Gemini APIs. It requires Google Cloud project access.

## 🔗 Endpoints

| Environment | URL | Status |
|-------------|-----|--------|
| **Daily (Sandbox)** | `https://daily-cloudcode-pa.sandbox.googleapis.com` | ✅ Active |
| **Production** | `https://cloudcode-pa.googleapis.com` | ✅ Active |

## 🤖 Supported Models

| Model Name | Model ID | Type | Status |
|------------|----------|------|--------|
| **Claude Sonnet 4.5** | `claude-sonnet-4-5` | Anthropic | ✅ Verified |
| **Claude Sonnet 4.5 Thinking** | `claude-sonnet-4-5-thinking` | Anthropic | ✅ Verified |
| **Claude Opus 4.5 Thinking** | `claude-opus-4-5-thinking` | Anthropic | ✅ Verified |
| **Gemini 3 Pro High** | `gemini-3-pro-high` | Google | ✅ Verified |
| **Gemini 3 Pro Low** | `gemini-3-pro-low` | Google | ✅ Verified |
| **GPT-OSS 120B Medium** | `gpt-oss-120b-medium` | Other | ✅ Verified |

## 🔑 Authentication & Headers

Requires Google Cloud OAuth 2.0.

### Headers

```http
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: antigravity/1.11.5 windows/amd64
X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
Client-Metadata: {"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}
x-quota-project: {project_id}
```

For streaming, add: `Accept: text/event-stream`.

## 📨 Request Format

**⚠️ Constraint**: Must use **Gemini API format** (`contents` array) for ALL models, including Claude.

### Structure

```json
{
  "project": "{project_id}",
  "model": "{model_id}",
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "Hello" }]
      },
      {
        "role": "model",
        "parts": [{ "text": "Hi there" }]
      }
    ],
    "systemInstruction": {
      "parts": [{ "text": "You are a helpful assistant." }]
    },
    "tools": [
      {
        "functionDeclarations": [
          {
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
              "type": "object",
              "properties": {
                "location": { "type": "string" }
              },
              "required": ["location"]
            }
          }
        ]
      }
    ],
    "generationConfig": {
      "maxOutputTokens": 1000,
      "temperature": 0.7,
      "thinkingConfig": {
        "thinkingBudget": 8000,
        "includeThoughts": true
      }
    }
  },
  "requestId": "{unique_id}"
}
```

### Critical Constraints

1.  **System Instructions**: Must be an object `{ "parts": [...] }`. Plain strings cause **400 Error**.
2.  **Role Names**: strict `user` and `model`. **`assistant` is NOT allowed**.
3.  **JSON Schema**:
    *   **Allowed**: `type`, `properties`, `required`, `enum`, `items`, `description`, `anyOf`, `allOf`, `oneOf`.
    *   **BANNED**: `const` (use `enum`), `$ref`, `$defs`, `default`, `examples`, `$schema`.
4.  **Tool Names**:
    *   Regex: `^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$`
    *   Allowed: `get_weather`, `mcp:db.query`, `read-file`
    *   Banned: `mcp/query` (slash), `123tool` (digit start)

## 🌊 Streaming

Endpoint: `/v1internal:streamGenerateContent?alt=sse`

Response format is standard Gemini SSE.

## 📤 Response Format

Includes extended metadata:

```json
{
  "candidates": [...],
  "usageMetadata": {
    "promptTokenCount": 123,
    "candidatesTokenCount": 456,
    "totalTokenCount": 579,
    "thoughtsTokenCount": 100
  }
}
```

## 🐛 Troubleshooting

| Error | Code | Cause | Solution |
|-------|------|-------|----------|
| **Not Found** | 404 | Invalid Model ID | Use verified IDs (e.g., `gemini-3-pro-high`). |
| **Resource Exhausted** | 429 | Rate Limit | High traffic. Retry or rotate accounts. |
| **Invalid Argument** | 400 | Bad Request | Check `systemInstruction` format (must be object) or schema (no `const`). |
| **Internal Error** | 500 | Gateway Error | Payload too large (>400KB) or internal failure. |

## 📚 References

- [Source Code](../../packages/server/src/providers/antigravity.ts)
