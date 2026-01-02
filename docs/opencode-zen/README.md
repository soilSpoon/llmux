# opencode.ai/zen API Specification for GLM/Kimi Models

**Version:** 1.0  
**Last Updated:** January 1, 2026  
**Status:** Verified by Direct API Testing

---

## Overview

opencode.ai/zen is a unified API gateway that provides access to multiple AI models including GLM (Zhipu AI), Kimi, Grok, Claude, and Gemini through different protocol endpoints.

### Key Characteristics

- **Multiple protocol endpoints** (OpenAI, Anthropic, Gemini format)
- **Model-specific routing** based on model name prefix
- **Free tier models** available (e.g., `glm-4.7-free`)
- **Thinking/Reasoning support** for GLM 4.7 models

---

## Endpoints

| Protocol | URL | Supported Models |
|----------|-----|------------------|
| **OpenAI** | `https://opencode.ai/zen/v1/chat/completions` | GLM, Kimi, Grok, GPT-5, big-pickle |
| **Anthropic** | `https://opencode.ai/zen/v1/messages` | Claude |
| **Gemini** | `https://opencode.ai/zen/v1/generateContent` | Gemini |

### Protocol Resolution

| Model Prefix | Protocol | Endpoint |
|--------------|----------|----------|
| `glm-*` | OpenAI | `/v1/chat/completions` |
| `kimi*` | OpenAI | `/v1/chat/completions` |
| `grok*` | OpenAI | `/v1/chat/completions` |
| `gpt-5*` | OpenAI | `/v1/chat/completions` |
| `qwen*` | OpenAI | `/v1/chat/completions` |
| `big-pickle` | OpenAI | `/v1/chat/completions` |
| `claude*` or `*claude*` | Anthropic | `/v1/messages` |
| `gemini*` | Gemini | `/v1/generateContent` |

---

## Available Models

| Model ID | Provider | Thinking Support | Status |
|----------|----------|------------------|--------|
| `glm-4.7-free` | Zhipu AI | ✅ Default enabled | ✅ Verified |
| `glm-4.6` | Zhipu AI | ✅ With config | ✅ Verified |
| `kimi-k2-thinking` | Moonshot | ✅ Default enabled | ✅ Verified |

---

## Request Format (OpenAI Protocol)

### Basic Structure

```json
{
  "model": "glm-4.7-free",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 1000
}
```

### Messages Array

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" },
    { "role": "user", "content": "How are you?" }
  ]
}
```

| Role | Description |
|------|-------------|
| `system` | System instructions |
| `user` | User messages |
| `assistant` | Model responses |
| `tool` | Tool/function results |

### Generation Config

| Field | Type | Description | Status |
|-------|------|-------------|--------|
| `max_tokens` | number | Maximum tokens in response | ✅ Supported |
| `temperature` | number | Randomness (0.0 - 2.0) | ✅ Supported |
| `top_p` | number | Nucleus sampling threshold | ✅ Supported |
| `stop` | string[] | Stop sequences | ✅ Supported |

---

## Thinking/Reasoning Control

### ✅ Supported Method

GLM 4.7 and Kimi models support thinking control via the `thinking` parameter:

```json
{
  "model": "glm-4.7-free",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 100,
  "thinking": {
    "type": "disabled"
  }
}
```

| `thinking.type` | Description | Result |
|-----------------|-------------|--------|
| `"disabled"` | Disable thinking/reasoning | Model responds directly without reasoning |
| `"enabled"` | Enable thinking (default for GLM 4.7) | Model includes reasoning in response |

### Thinking Response Format

When thinking is enabled, the response includes `reasoning_content`:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "2",
        "reasoning_content": "Let me think... 1+1=2. The answer is 2."
      },
      "finish_reason": "stop"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `message.content` | Final answer/response |
| `message.reasoning_content` | Thinking/reasoning process (only when thinking enabled) |

### ❌ NOT Supported Methods

The following methods will cause errors:

| Method | Parameter | Error |
|--------|-----------|-------|
| chat_template_args | `"chat_template_args": { "enable_thinking": false }` | `Cannot read properties of undefined (reading 'prompt_tokens')` |
| reasoning_effort | `"reasoning_effort": "none"` | `Cannot read properties of undefined (reading 'prompt_tokens')` |
| Anthropic endpoint for GLM | POST to `/v1/messages` | `Cannot read properties of undefined (reading 'prompt_tokens')` |

---

## Tools / Function Calling

### Tool Definition (OpenAI Format)

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "set_title",
        "description": "Set a title for the conversation",
        "parameters": {
          "type": "object",
          "properties": {
            "title": {
              "type": "string",
              "description": "The title to set"
            }
          },
          "required": ["title"]
        }
      }
    }
  ]
}
```

### Tool Choice

```json
{
  "tool_choice": {
    "type": "function",
    "function": {
      "name": "set_title"
    }
  }
}
```

| `tool_choice` Value | Description |
|---------------------|-------------|
| `"auto"` | Model decides whether to use tools |
| `"none"` | Model will not use any tools |
| `"required"` | Model must use at least one tool |
| `{ "type": "function", "function": { "name": "..." } }` | Force specific tool |

### Tool Call Response

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "",
        "tool_calls": [
          {
            "id": "call_-8021303700306362201",
            "type": "function",
            "function": {
              "name": "set_title",
              "arguments": "{\"title\":\"Hello\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

### Combined: Tools + Thinking Disabled

✅ **Verified Working** - You can use tools with thinking disabled:

```json
{
  "model": "glm-4.7-free",
  "messages": [{ "role": "user", "content": "Set title for: Hello" }],
  "max_tokens": 100,
  "thinking": { "type": "disabled" },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "set_title",
        "parameters": { "type": "object", "properties": { "title": { "type": "string" } } }
      }
    }
  ],
  "tool_choice": { "type": "function", "function": { "name": "set_title" } }
}
```

---

## Response Format

### Standard Response

```json
{
  "id": "202601011806393e9e505ab49248cf",
  "object": "chat.completion",
  "created": 1767262000,
  "model": "glm-4.7",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 12,
    "total_tokens": 21,
    "prompt_tokens_details": {
      "cached_tokens": 2
    }
  },
  "request_id": "202601011806393e9e505ab49248cf"
}
```

| Field | Description |
|-------|-------------|
| `id` | Request ID |
| `object` | Always `"chat.completion"` |
| `model` | Actual model used (e.g., `glm-4.7` for `glm-4.7-free`) |
| `choices[].message.content` | Response text |
| `choices[].message.reasoning_content` | Thinking content (if enabled) |
| `choices[].finish_reason` | `stop`, `length`, `tool_calls` |
| `usage.prompt_tokens` | Input tokens |
| `usage.completion_tokens` | Output tokens |
| `usage.prompt_tokens_details.cached_tokens` | Cached prompt tokens |

---

## Error Responses

### Error Structure

```json
{
  "type": "error",
  "error": {
    "type": "error",
    "message": "Error description"
  }
}
```

### Common Errors

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `Cannot read properties of undefined (reading 'prompt_tokens')` | Invalid parameter (e.g., `chat_template_args`, wrong endpoint) | Use `thinking: { type: "disabled" }` instead |
| Rate limit errors | Too many requests | Implement retry with backoff |

---

## NOT Supported Features

| Feature | Parameter | Error |
|---------|-----------|-------|
| chat_template_args | `chat_template_args: {...}` | Server error |
| reasoning_effort | `reasoning_effort: "none"` | Server error |
| cache_control | `cache_control: {...}` | Unknown field |
| Anthropic format tools | `input_schema` instead of `parameters` | May need transformation |

---

## Implementation Notes

### Anthropic Tool Format Transformation

If receiving Anthropic-style tools, transform to OpenAI format:

```typescript
// Anthropic format (input)
{
  "name": "set_title",
  "description": "Set a title",
  "input_schema": { ... }
}

// OpenAI format (output)
{
  "type": "function",
  "function": {
    "name": "set_title",
    "description": "Set a title",
    "parameters": { ... }
  }
}
```

### Beta Fields Removal

Remove `cache_control` from all nested objects as it's not supported.

---

## Complete Request Example

### With Thinking Disabled + Tools

```json
{
  "model": "glm-4.7-free",
  "messages": [
    { "role": "user", "content": "Generate a title for this conversation about AI" }
  ],
  "max_tokens": 100,
  "temperature": 0.7,
  "thinking": {
    "type": "disabled"
  },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "set_title",
        "description": "Set a descriptive title for the conversation",
        "parameters": {
          "type": "object",
          "properties": {
            "title": {
              "type": "string",
              "description": "A short, descriptive title"
            }
          },
          "required": ["title"]
        }
      }
    }
  ],
  "tool_choice": {
    "type": "function",
    "function": { "name": "set_title" }
  }
}
```

---

## Changelog

- **2026-01-01**: Initial specification - Verified `thinking: { type: "disabled" }` works for GLM 4.7-free
- **2026-01-01**: Documented that `chat_template_args` and `reasoning_effort` do NOT work
- **2026-01-01**: Confirmed tools + thinking disabled combination works
