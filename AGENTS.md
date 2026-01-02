# AGENTS.md

Instructions for AI coding agents working on the llmux project.

## Project Overview

llmux is a TypeScript monorepo for bidirectional LLM API transformation. It utilizes a layered architecture to route and transform requests between various AI providers.

## 🛠️ Build & Development Commands

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Type check (runs build first)
bun run typecheck

# Run tests
bun run test

# Lint & Format
bun run lint
bun run format
```

### Package Scoped Commands

```bash
# Build specific package
bun run --filter @llmux/core build

# Test specific package
bun run --filter @llmux/server test

# CLI Development
bun run --filter @llmux/cli serve:dev
```

## 📂 Project Structure

```
packages/
├── core/     # @llmux/core - SDK, Types, Transformations
├── auth/     # @llmux/auth - OAuth, Credentials, Token Refresh
├── server/   # @llmux/server - Proxy Server (Handlers, Routing, Upstream)
└── cli/      # @llmux/cli - CLI Tools
```

## 🏗️ Architecture Layers (Server)

When modifying `@llmux/server`, respect the following layers:

1.  **Handlers** (`src/handlers/`): Thin wrappers that coordinate logic. Do not put business logic here.
2.  **Routing** (`src/routing/`): Logic for resolving models to providers (`ModelRouter`).
3.  **Providers** (`src/providers/`): Provider-specific context preparation (e.g., Antigravity Auth headers).
4.  **Upstream** (`src/upstream/`): Generic HTTP client and endpoint management.

## 📝 Code Style & Conventions

- **Linting**: Use `bun run lint` (Biome).
- **Formatting**: Use `bun run format` (Biome).
- **Imports**: Use explicit paths for internal modules.
- **Logging**: Use `createLogger` from `@llmux/core`.

## 🧪 Testing

- **Framework**: Bun test
- **Run All**: `bun run test`
- **Specific File**: `bun test packages/core/test/transform.test.ts`

## 📚 Key Documentation

- **[README.md](README.md)**: General overview and usage.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: Detailed system architecture.
- **[docs/ENDPOINTS.md](docs/ENDPOINTS.md)**: API endpoint details.
