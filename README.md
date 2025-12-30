# llmux

LLM Provider Proxy Library - Bidirectional transformation between AI providers.

## Overview

llmux is a TypeScript SDK that enables bidirectional transformation of requests and responses between multiple AI providers (OpenAI, Anthropic, Gemini, Antigravity, OpenAI-Web, Opencode-Zen).

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

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              llmux Monorepo                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  @llmux/cli │───▶│@llmux/server│───▶│ @llmux/auth │───▶│ @llmux/core │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│        │                  │                  │                  │          │
│        │                  │                  │                  │          │
│        ▼                  ▼                  ▼                  ▼          │
│   ┌─────────┐       ┌──────────┐       ┌──────────┐       ┌──────────┐     │
│   │Commands │       │ Handlers │       │ Providers│       │Providers │     │
│   │ • auth  │       │ • proxy  │       │• GitHub  │       │• OpenAI  │     │
│   │ • serve │       │ • stream │       │  Copilot │       │• Anthropic│    │
│   │ • config│       │ • models │       │• OpenAI  │       │• Gemini  │     │
│   │ • proxy │       │ • respond│       │  Web     │       │• etc.    │     │
│   └─────────┘       └──────────┘       └──────────┘       └──────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Request/Response Flow

```
Client Request                                              Target API
     │                                                          ▲
     ▼                                                          │
┌─────────────────────────────────────────────────────────────────────────┐
│                           llmux Server                                  │
│  ┌──────────┐    ┌──────────────────┐    ┌──────────────────┐          │
│  │  Router  │───▶│ Format Detection │───▶│ Source Provider  │          │
│  └──────────┘    └──────────────────┘    │   parse()        │          │
│                                          └────────┬─────────┘          │
│                                                   ▼                    │
│                                          ┌──────────────────┐          │
│                                          │  UnifiedRequest  │          │
│                                          └────────┬─────────┘          │
│                                                   ▼                    │
│                                          ┌──────────────────┐          │
│                                          │ Target Provider  │──────────┼──▶
│                                          │   transform()    │          │
│                                          └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Features

- **Bidirectional transformation**: All provider combinations supported
- **SSE streaming**: Real-time streaming transformation
- **Responses API**: OpenAI Responses API (`/v1/responses`) support
- **Thinking support**: Claude thinking blocks, Gemini thoughtSignature
- **Tool calling**: Full function/tool calling support across providers
- **Type-safe**: Full TypeScript support with strict types
- **OAuth Authentication**: GitHub Copilot, OpenAI Web, Antigravity OAuth support
- **Fallback & Cooldown**: Automatic fallback with cooldown management
- **Model Mapping**: Flexible model name routing and mapping

## Packages

| Package | Description |
|---------|-------------|
| [`@llmux/core`](packages/core) | Core SDK - Provider implementations, transformation logic, type definitions |
| [`@llmux/auth`](packages/auth) | Authentication module - OAuth providers, credential storage, token refresh |
| [`@llmux/server`](packages/server) | Proxy server - HTTP handlers, routing, middleware, Amp CLI support |
| [`@llmux/cli`](packages/cli) | CLI tool - Interactive authentication, server management |

## Supported Providers

### Transformation Providers (@llmux/core)

| Provider | Request | Response | Streaming |
|----------|:-------:|:--------:|:---------:|
| OpenAI | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ |
| Gemini | ✅ | ✅ | ✅ |
| Antigravity | ✅ | ✅ | ✅ |
| OpenAI-Web | ✅ | ✅ | ✅ |
| Opencode-Zen | ✅ | ✅ | ✅ |

### Authentication Providers (@llmux/auth)

| Provider | OAuth | Device Flow | API Key |
|----------|:-----:|:-----------:|:-------:|
| GitHub Copilot | ✅ | ✅ | - |
| OpenAI Web | ✅ | - | - |
| Antigravity | ✅ | ✅ | - |
| Opencode-Zen | ✅ | - | - |

## Installation

```bash
# Using bun (recommended)
bun install

# Using npm
npm install
```

## Quick Start

### 1. Core Library Usage

```typescript
import { transformRequest, transformResponse, getProvider } from '@llmux/core'

// Get a provider instance
const anthropicProvider = getProvider('anthropic')

// Parse incoming request to unified format
const unified = anthropicProvider.parse(incomingRequest)

// Transform to target provider format
const openaiProvider = getProvider('openai')
const openaiRequest = openaiProvider.transform(unified)
```

### 2. Start Proxy Server

```bash
# Using CLI
bun run --filter @llmux/cli serve

# Or programmatically
```

```typescript
import { startServer } from '@llmux/server'

const server = await startServer({
  port: 8743,
  hostname: 'localhost',
})

console.log(`Server running on http://${server.hostname}:${server.port}`)
```

### 3. With Amp CLI Support

```typescript
import { startServer, type AmpConfig } from '@llmux/server'

const ampConfig: AmpConfig = {
  handlers: {
    openai: async (req) => {
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
  upstreamUrl: 'https://api.ampcode.com',
  upstreamApiKey: process.env.AMP_API_KEY,
  providerChecker: (model) => {
    const localModels = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-20250514']
    return localModels.includes(model)
  },
}

const server = await startServer({ port: 8743, amp: ampConfig })
```

## API Endpoints

See [packages/server/ENDPOINTS.md](packages/server/ENDPOINTS.md) for complete endpoint documentation.

### Quick Reference

| Endpoint | Format | Default Target | Use Case |
|----------|--------|----------------|----------|
| `/v1/chat/completions` | OpenAI | openai | OpenAI SDK compatibility |
| `/v1/messages` | Anthropic | anthropic | Anthropic SDK compatibility |
| `/v1/generateContent` | Gemini | gemini | Gemini API compatibility |
| `/v1/auto` | Auto-detect | Detected | Universal routing |
| `/v1/proxy` | Auto-detect | Header required | Explicit control |
| `/v1/responses` | OpenAI | openai | OpenAI Responses API |

### Headers

| Header | Purpose |
|--------|---------|
| `X-Target-Provider` | Override target provider |
| `X-Target-Model` | Override model name |
| `X-API-Key` | Provide API key |

## CLI Commands

```bash
# Authentication
llmux auth login <provider>     # OAuth login
llmux auth logout <provider>    # Remove credentials
llmux auth status               # Show auth status

# Server
llmux serve                     # Start proxy server
llmux serve --port 8080         # Custom port

# Configuration
llmux config show               # Show current config
llmux config set <key> <value>  # Set config value

# Proxy
llmux proxy <endpoint>          # Proxy single request

# Stream
llmux stream                    # Interactive streaming
```

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Type check
bun run typecheck

# Run tests
bun run test

# Lint
bun run lint

# Format
bun run format
```

### Package-specific Commands

```bash
# Build specific package
bun run --filter @llmux/core build

# Test specific package
bun run --filter @llmux/server test

# Development mode for CLI
bun run --filter @llmux/cli serve:dev
```

## Project Structure

```
llmux/
├── packages/
│   ├── core/                 # Core transformation library
│   │   ├── src/
│   │   │   ├── providers/    # Provider implementations
│   │   │   │   ├── openai/
│   │   │   │   ├── anthropic/
│   │   │   │   ├── gemini/
│   │   │   │   ├── antigravity/
│   │   │   │   ├── openai-web/
│   │   │   │   ├── opencode-zen/
│   │   │   │   ├── ai-sdk/
│   │   │   │   ├── base.ts
│   │   │   │   └── registry.ts
│   │   │   ├── transform/    # Request/Response transformation
│   │   │   ├── types/        # Unified type definitions
│   │   │   ├── cache/        # Signature caching
│   │   │   ├── responses/    # OpenAI Responses API
│   │   │   └── index.ts
│   │   └── test/
│   │
│   ├── auth/                 # Authentication module
│   │   ├── src/
│   │   │   ├── providers/    # OAuth provider implementations
│   │   │   ├── storage.ts    # Credential storage
│   │   │   ├── refresh.ts    # Token refresh logic
│   │   │   └── index.ts
│   │   └── test/
│   │
│   ├── server/               # HTTP server
│   │   ├── src/
│   │   │   ├── handlers/     # Request handlers
│   │   │   ├── amp/          # Amp CLI routes
│   │   │   ├── middleware/   # CORS, format detection
│   │   │   ├── upstream/     # Upstream proxy
│   │   │   ├── models/       # Model lookup
│   │   │   ├── server.ts     # Main server
│   │   │   └── router.ts     # HTTP router
│   │   └── test/
│   │
│   └── cli/                  # Command-line interface
│       ├── src/
│       │   ├── commands/     # CLI commands
│       │   └── index.ts
│       └── test/
│
├── docs/                     # Documentation
├── examples/                 # Usage examples
├── package.json              # Monorepo root config
├── biome.json                # Linting/formatting config
└── tsconfig.json             # TypeScript config
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript 5.9+
- **Build**: [bunup](https://github.com/so1ve/bunup)
- **Linting/Formatting**: [Biome](https://biomejs.dev)
- **Testing**: Bun test
- **Validation**: [Zod](https://zod.dev) 4.x
- **Logging**: [Pino](https://getpino.io)
- **CLI**: [Yargs](https://yargs.js.org)
- **AI SDK Integration**: Vercel AI SDK compatible

## License

MIT
