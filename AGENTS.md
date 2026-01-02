# AGENTS.md

Instructions for AI coding agents working on the llmux project.

## Project Overview

llmux is a TypeScript monorepo for bidirectional LLM API transformation. It enables routing requests between different AI providers (OpenAI, Anthropic, Gemini, Antigravity, etc.) by translating request/response formats through a unified intermediate representation.

**Key Concept**: Source Provider → UnifiedRequest → Target Provider → UnifiedResponse → Source Response

## Build & Development Commands

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Type check (runs build first, then typechecks)
bun run typecheck

# Run tests
bun run test

# Lint
bun run lint

# Format
bun run format

# Clean build artifacts
bun run clean
```

### Package-specific Commands

```bash
# Build specific package
bun run --filter @llmux/core build
bun run --filter @llmux/auth build
bun run --filter @llmux/server build
bun run --filter @llmux/cli build

# Test specific package
bun run --filter @llmux/core test
bun run --filter @llmux/server test

# Run CLI in dev mode
bun run --filter @llmux/cli serve:dev
```

## Project Structure

```
packages/
├── core/     # @llmux/core - Core transformation library (no dependencies)
├── auth/     # @llmux/auth - OAuth/authentication (depends on core)
├── server/   # @llmux/server - HTTP server (depends on core, auth)
└── cli/      # @llmux/cli - CLI tool (depends on all)
```

### Dependency Order

```
@llmux/core (base)
    ↑
@llmux/auth
    ↑
@llmux/server
    ↑
@llmux/cli
```

## Code Style Guidelines

### General

- **No comments** unless code is complex and requires context
- Use **Biome** for linting and formatting (`bun run lint`, `bun run format`)
- Prefer **explicit types** over inference for public APIs
- Use **Zod** for runtime validation (v4.x)
- Use **Pino** for logging

### TypeScript Conventions

```typescript
// Exports: Group and order by type
export type { ... }   // Types first
export { ... }        // Then implementations

// Imports: Use explicit paths for internal modules
import { transformRequest } from './transform/request'
import type { UnifiedRequest } from '../types/unified'

// Provider implementation pattern
export class MyProvider extends BaseProvider {
  readonly name = 'my-provider' as const
  readonly config: ProviderConfig = { ... }
  
  parse(request: unknown): UnifiedRequest { ... }
  transform(request: UnifiedRequest, model?: string): unknown { ... }
  parseResponse(response: unknown): UnifiedResponse { ... }
  transformResponse(response: UnifiedResponse): unknown { ... }
}
```

### File Naming

- Use **kebab-case** for file names: `account-rotation.ts`, `openai-web.ts`
- Use **index.ts** for barrel exports in directories
- Test files: `*.test.ts` in `test/` directory

### Logging

```typescript
import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'my-service' })
logger.info({ key: 'value' }, 'Message')
logger.debug({ ... }, 'Debug message')
logger.error({ error: message }, 'Error message')
```

## Testing

- Test framework: **Bun test** (built-in)
- Test files location: `packages/*/test/`
- Run all tests: `bun run test`
- Run specific test: `bun test packages/core/test/transform.test.ts`

```typescript
import { describe, it, expect } from 'bun:test'

describe('MyFeature', () => {
  it('should do something', () => {
    expect(result).toBe(expected)
  })
})
```

## Key Patterns

### 1. Provider Implementation

All providers implement the `Provider` interface:

```typescript
interface Provider {
  name: ProviderName
  config: ProviderConfig
  parse(request: unknown): UnifiedRequest
  transform(request: UnifiedRequest, model?: string): unknown
  parseResponse(response: unknown): UnifiedResponse
  transformResponse(response: UnifiedResponse): unknown
  parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  transformStreamChunk?(chunk: StreamChunk): string | string[]
}
```

### 2. Request Transformation Flow

```typescript
// 1. Parse source format to unified
const unified = sourceProvider.parse(sourceRequest)

// 2. Transform unified to target format
const targetRequest = targetProvider.transform(unified, targetModel)

// 3. Call target API
const targetResponse = await fetch(targetUrl, { body: targetRequest })

// 4. Parse target response to unified
const unifiedResponse = targetProvider.parseResponse(targetResponse)

// 5. Transform unified to source format
const sourceResponse = sourceProvider.transformResponse(unifiedResponse)
```

### 3. Server Handler Pattern

```typescript
function createMyHandler(options: Options) {
  return async (request: Request): Promise<Response> => {
    // Parse body
    const body = await request.clone().json()
    
    // Process
    const result = await process(body, options)
    
    // Return response
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
```

### 4. Auth Provider Pattern

```typescript
class MyAuthProvider implements AuthProvider {
  async authenticate(step: AuthStep): Promise<AuthResult> { ... }
  async refresh(token: string): Promise<AuthResult> { ... }
  async getToken(): Promise<string> { ... }
}
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/server/src/server.ts` | Main server with route registration |
| `packages/server/src/router.ts` | HTTP router implementation |
| `packages/server/src/routing/model-router.ts` | Model routing logic |
| `packages/server/src/routing/model-rules.ts` | Model rules and prefix definitions |
| `packages/server/src/handlers/codex.ts` | Codex/Copilot specific handling |
| `packages/server/src/handlers/responses.ts` | Responses API implementation |
| `packages/server/src/handlers/account-rotation.ts` | Account rotation handler |
| `packages/server/src/handlers/signature-integration.ts` | Request deduplication via signatures |
| `packages/server/src/handlers/thinking-recovery.ts` | Thinking/reasoning content recovery |
| `packages/server/src/cooldown.ts` | Rate limit cooldown management |
| `packages/auth/src/providers/registry.ts` | Auth provider registry |
| `packages/server/ENDPOINTS.md` | API endpoint documentation |

## Adding a New Provider

1. Create directory: `packages/core/src/providers/my-provider/`
2. Implement files:
   - `types.ts` - Provider-specific types
   - `request.ts` - Request parsing/transformation
   - `response.ts` - Response parsing/transformation
   - `streaming.ts` - Streaming support (optional)
   - `index.ts` - Export provider class
3. Register in `packages/core/src/providers/registry.ts`
4. Export from `packages/core/src/index.ts`
5. **Update Routing**: Add model prefixes/rules in `packages/server/src/routing/model-rules.ts`.
6. **Consider Cooldowns**: Ensure error handling triggers cooldowns if applicable.

## Adding a New Auth Provider

1. Create file: `packages/auth/src/providers/my-provider.ts`
2. Implement `AuthProvider` interface
3. Register in `packages/auth/src/providers/registry.ts`
4. Export from `packages/auth/src/index.ts`

## Common Issues

### Type Errors After Changes

Run full build before typecheck:
```bash
bun run build && bun run typecheck
```

### Workspace Dependencies

Use `workspace:*` for internal dependencies:
```json
{
  "dependencies": {
    "@llmux/core": "workspace:*"
  }
}
```

### Streaming Responses

Always set proper headers for SSE:
```typescript
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
})
```

## Security Considerations

- Never log API keys or tokens
- Use `X-API-Key` header for explicit keys, OAuth for others
- Credentials stored in `~/.llmux/credentials.json`
- Token refresh handled automatically by `TokenRefresh` class

## Monorepo Configuration

- **Workspaces**: Bun workspaces in root `package.json`
- **Build tool**: `bunup` for each package
- **Lint/Format**: Biome (shared config in root `biome.json`
- **TypeScript**: Project references, shared config in root `tsconfig.json`
- **Git hooks**: Husky + lint-staged for pre-commit checks

## Provider-Specific Documentation

- [opencode-zen GLM 4.7 Thinking Control](docs/OPENCODE_ZEN_THINKING.md) - How to disable thinking for GLM/Kimi models
- [Antigravity Streaming & Models](docs/antigravity/STREAMING_AND_MODELS.md) - Gemini/Claude streaming support status and references

## Providers & Registries

### Core Providers (`packages/core`)
- **opencode-zen**: Unified gateway for GLM, Kimi, Grok, etc.
- **antigravity**: Google's unified gateway (Claude, Gemini).
- **anthropic**: Direct Anthropic API.
- **openai**: Direct OpenAI API.
- **gemini**: Direct Google Gemini API.
- **openai-web**: Web-based OpenAI access.
- **ai-sdk**: Vercel AI SDK integration.

### Auth Providers (`packages/auth`)
- **github-copilot**: GitHub Copilot token management.
- **opencode-zen**: Auth for OpenCode Zen.
- **antigravity**: Auth for Antigravity (combined OAuth/Server).
- **antigravity-server**: Antigravity server-side auth.
- **antigravity-oauth**: Antigravity OAuth flow.
- **openai-server**: OpenAI server-side auth.
- **openai-web**: OpenAI web-based auth.

## Routing & Model Rules

Requests are routed based on model prefixes and aliases defined in `model-rules.ts` and `model-router.ts`.

- **Prefix Matching**: `glm-*` -> OpenAI protocol, `claude-*` -> Anthropic protocol.
- **Aliases**: `gemini-pro` -> `gemini-1.5-pro`.
- **Protocol Transformation**: Automatically converts between OpenAI, Anthropic, and Gemini formats.

## Cooldown, Account Rotation & Signatures

- **Account Rotation**: Automatically rotates between available credentials to distribute load.
- **Cooldowns**: Temporarily disables accounts that hit rate limits (429) or errors.
- **Signatures**: Uses `SignatureCache` to detect and deduplicate identical requests, preventing redundant processing.

## Thinking, Reasoning & OpenAI Responses API

- **Thinking Control**: Supports `thinking: { type: "enabled" | "disabled" }` for models like GLM-4.7 and Kimi.
- **Reasoning Content**: Maps `reasoning_content` to standard fields.
- **Responses API**: `/v1/responses` endpoint provides access to raw provider responses for debugging and analysis.

## Debugging & Analysis Resources

For code change analysis and root cause investigation:

- **[ROOT_CAUSE_FOUND.md](docs/debugging/ROOT_CAUSE_FOUND.md)** - Diagnosis of Antigravity streaming issues (Gemini vs Claude).
