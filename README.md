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

## License

MIT
