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
| `packages/core/src/providers/base.ts` | Provider interface definition |
| `packages/core/src/transform/request.ts` | Request transformation logic |
| `packages/core/src/transform/response.ts` | Response transformation logic |
| `packages/core/src/types/unified.ts` | Unified request/response types |
| `packages/server/src/server.ts` | Main server with route registration |
| `packages/server/src/router.ts` | HTTP router implementation |
| `packages/server/ENDPOINTS.md` | API endpoint documentation |
| `packages/auth/src/providers/base.ts` | Auth provider interface |

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

- [opencode-zen GLM 4.7 Thinking Control](docs/OPENCODE_ZEN_THINKING.md) - GLM/Kimi thinking 비활성화 방법
