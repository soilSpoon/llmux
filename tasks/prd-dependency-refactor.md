# PRD: Refactor llmux Dependency Architecture (Hub-and-Spoke Alignment)

## Introduction
Refactor the llmux codebase to align with a strict **Hub-and-Spoke architecture**. Currently, the "Hub" (`@llmux/core`) leaks implementation details of the "Spokes" (Providers) and contains runtime/server concerns. This project will purify `@llmux/core` into a provider-agnostic transformation layer, move execution concerns to a new `@llmux/runtime` package (or appropriate layer), and eliminate hardcoded dependencies using strategy patterns.

## Goals
- **Purify Core:** Ensure `@llmux/core` contains ZERO provider-specific hardcoding (e.g., specific model names, specific provider logic in transforms).
- **Separate Concerns:** Move runtime/execution types (Upstream, Network, Headers) out of `@llmux/core`.
- **Enforce Architecture:** Implement linting rules to prevent future architecture violations (e.g., `formats` cannot import `providers`).
- **Hub-and-Spoke:** Establish clear boundaries where Core acts as the central hub for types/transforms, and Providers/Runtime depend on Core, not vice-versa.

## Phased Approach
This project will be executed in phases to ensure stability while achieving fundamental architectural changes.

### Phase 1: Architecture Definition & Runtime Separation
Establish the new structure by creating `@llmux/runtime` and moving execution concerns.

### Phase 2: Core Purification
Remove hardcoded provider logic from the Core transformation layer.

### Phase 3: API Cleanup & Enforcement
Clean up public exports and enforce boundaries with linting tools.

## User Stories

### Phase 1: Architecture Definition & Runtime Separation

#### US-101: Create @llmux/runtime package
**Description:** As a developer, I want a dedicated package for execution interfaces so that Core remains focused on data transformation.
**Acceptance Criteria:**
- [ ] Create `packages/runtime` with `package.json` and build config.
- [ ] Configure workspace (pnpm/bun) to recognize the new package.
- [ ] Verify package builds successfully.

#### US-102: Migrate Upstream types and interfaces
**Description:** As a developer, I want to move server-side execution types out of Core.
**Acceptance Criteria:**
- [ ] Move `UpstreamContext`, `PrepareUpstreamOptions` from `core/src/types/provider-strategies.ts` to `@llmux/runtime`.
- [ ] Move `UpstreamPreparationStrategy` interface to `@llmux/runtime` (or `server` if strictly internal, but runtime is preferred for sharing types).
- [ ] Update imports in `core`, `server`, and `providers` to point to new locations.
- [ ] Typecheck passes across the monorepo.

### Phase 2: Core Purification

#### US-201: Refactor Request Transformation to eliminate hardcoding
**Description:** As a developer, I want to remove `targetProvider === 'gemini'` checks from `transformRequest` to make it provider-agnostic.
**Acceptance Criteria:**
- [ ] Identify the hardcoded validation logic in `packages/core/src/transform/request.ts` (e.g., JSON schema validation for Gemini).
- [ ] Introduce a `validateUnifiedRequest(request)` hook in the `SchemaFormat` interface or `ProviderStrategy`.
- [ ] Move the specific validation logic to the Gemini/Antigravity provider implementation or format.
- [ ] Update `transformRequest` to call this hook generically.
- [ ] Verify existing tests pass.

#### US-202: Relocate Provider-Specific Utils
**Description:** As a developer, I want to move provider-specific utilities out of the global Core scope.
**Acceptance Criteria:**
- [ ] Move Gemini-specific utils (`isGemini3WithTierSuffix`, token utils) from `core/src/util` to `core/src/providers/gemini/utils`.
- [ ] Move BackoffStrategies to their respective provider directories or a dedicated `runtime/backoff` module if generic.
- [ ] Update exports in `core/index.ts` to stop exposing these at the root level (or expose them via a `providers` namespace).
- [ ] Refactor imports in consumers (`server`, `cli`).

### Phase 3: API Cleanup & Enforcement

#### US-301: Enforce Dependency Boundaries via Linting
**Description:** As an architect, I want to prevent architectural regression using automated tools.
**Acceptance Criteria:**
- [ ] Configure ESLint `no-restricted-imports` (or `dependency-cruiser` if available).
- [ ] Rule 1: `packages/core/src/formats/**` must NOT import from `packages/core/src/providers/**`.
- [ ] Rule 2: `packages/core` must NOT import from `packages/server` or `packages/runtime` (circular check).
- [ ] Run linter and verify it catches violations.

#### US-302: Unify Logging Strategy
**Description:** As a developer, I want consistent logging across the library.
**Acceptance Criteria:**
- [ ] Replace `console.log` in `packages/core/src/providers/registry.ts` with the standardized `logger`.
- [ ] Ensure `logger` usage is consistent in Core.

## Functional Requirements
- **FR-1:** `@llmux/core` must not contain strings checking for specific providers (e.g., `if (provider === 'gemini')`) in common logic paths.
- **FR-2:** Execution-related interfaces (`Upstream*`) must reside in `@llmux/runtime` or `@llmux/server`.
- **FR-3:** Schema Formats must be independent of Provider implementations.

## Non-Goals
- rewriting the entire server implementation (only moving types/interfaces).
- changing the external API behavior (functionality should remain identical, though import paths will change).

## Technical Considerations
- **Breaking Changes:** This is a major refactor. Public API exports will change. Version bump required.
- **Hub-and-Spoke:** 
    - **Hub:** `@llmux/core` (Types, Transforms, Registry)
    - **Spokes:** Providers, Formats
    - **Runtime:** `@llmux/runtime` (Interfaces for execution, strategies)
    - **Application:** `@llmux/server`, `@llmux/cli`

## Success Metrics
- Zero circular dependencies.
- Zero "provider-name" string literals in `core/src/transform/*.ts`.
- Linter passes strict boundary checks.
- Build and Typecheck pass successfully.

## Open Questions
- Should `BackoffStrategy` belong to Core (logic) or Runtime (execution)? -> *Decision: Runtime is better suited, as backoff is about execution flow.*
