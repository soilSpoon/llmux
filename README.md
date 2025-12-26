# llmux

LLM Provider Proxy Library - Bidirectional transformation between AI providers.

## Overview

llmux is a TypeScript SDK that enables bidirectional transformation of requests and responses between multiple AI providers (OpenAI, Anthropic, Gemini, Antigravity).

```typescript
import { transformRequest, transformResponse } from '@llmux/core'

// Transform Gemini request → Anthropic API call → Gemini response
const anthropicRequest = transformRequest(geminiRequest, {
  from: 'gemini',
  to: 'anthropic',
})

const anthropicResponse = await callAnthropicAPI(anthropicRequest)

const geminiResponse = transformResponse(anthropicResponse, {
  from: 'anthropic',
  to: 'gemini',
})
```

## Features

- **Bidirectional transformation**: 12 provider combinations supported
- **SSE streaming**: Real-time streaming transformation
- **Responses API**: OpenAI Responses API (`/v1/responses`) support
- **Thinking support**: Claude thinking blocks, Gemini thoughtSignature
- **Tool calling**: Full function/tool calling support across providers
- **Type-safe**: Full TypeScript support with strict types

## Packages

| Package | Description |
|---------|-------------|
| `@llmux/core` | Core SDK library |
| `@llmux/auth` | Authentication module (optional) |
| `@llmux/server` | Proxy server (optional) |

## Supported Providers

| Provider | Request | Response | Streaming |
|----------|:-------:|:--------:|:---------:|
| OpenAI | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ |
| Gemini | ✅ | ✅ | ✅ |
| Antigravity | ✅ | ✅ | ✅ |

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Build
bun run build

# Test
bun test
```

## Amp CLI Support

llmux supports [Amp CLI](https://ampcode.com) compatible routing. This allows you to use local API keys (free) while falling back to ampcode.com when needed.

### Quick Start

```typescript
import { startServer, type AmpConfig } from '@llmux/server'

const ampConfig: AmpConfig = {
  handlers: {
    openai: async (req) => {
      // Handle OpenAI requests with your local API key
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: req.body,
      })
    },
    anthropic: async (req) => {
      // Handle Anthropic requests
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: req.body,
      })
    },
  },
  // Fallback to ampcode.com when local provider is unavailable
  upstreamUrl: 'https://api.ampcode.com',
  upstreamApiKey: process.env.AMP_API_KEY,
  // Check if local provider is available for the model
  providerChecker: (model) => {
    const localModels = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-20250514']
    return localModels.includes(model)
  },
}

const server = await startServer({ port: 8743, amp: ampConfig })
console.log(`Amp-compatible server running on port ${server.port}`)
```

### Amp Routes

When `amp` config is provided, the following routes are registered:

| Route | Method | Description |
|-------|--------|-------------|
| `/api/provider/:provider/v1/chat/completions` | POST | OpenAI chat completions |
| `/api/provider/:provider/v1/messages` | POST | Anthropic messages |
| `/api/provider/:provider/v1/models` | GET | List models |
| `/v1/responses` | POST | OpenAI Responses API |
| `/v1beta/models/*action` | POST | Gemini generateContent |

### Fallback Behavior

1. **Local Provider Available**: Request is handled locally (free)
2. **No Local Provider + Upstream Configured**: Request is proxied to ampcode.com (uses Amp credits)
3. **No Local Provider + No Upstream**: Returns 503 error

## License

MIT
