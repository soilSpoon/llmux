# llmux Refactoring Plan

**Version:** 1.0  
**Created:** 2025-01-01  
**Last Updated:** 2026-01-01  
**Status:** ✅ All Phases Completed (2026-01-02)

## Final Result Summary

The refactoring project (Phase 1-6) has been successfully completed.

### Key Achievements
- **Handler Structure Improvement**: Extracted common logic from `streaming.ts` and `proxy.ts` to `request-handler.ts` to eliminate duplication.
- **Routing Integration**: Introduced `ModelRouter` to unify model mapping, fallback, and rotation logic.
- **Antigravity Optimization**: Encapsulated auth and endpoint logic into `providers/antigravity.ts`.
- **Test Coverage**: All tests (510) passed and tests updated to match new architecture.

### File Size Changes
| File | Before Refactor | Final | Reduction |
|------|-----------|------|--------|
| `streaming.ts` | ~1641 lines | 408 lines | **-75%** |
| `proxy.ts` | ~782 lines | 367 lines | **-53%** |
| `responses.ts` | ~526 lines | 244 lines | **-53%** |
| `server.ts` | ~682 lines | 390 lines | **-42%** |

### New Modules
- `handlers/request-handler.ts`: Common request processing logic
- `handlers/stream-transformer.ts`: Stream transformation logic
- `handlers/gemini-response.ts`: Gemini SSE parsing logic
- `handlers/response-utils.ts`: Response processing utilities
- `routing/`: Routing related modules (Router, ModelRouter, rules, etc.)

---

## Overview

This is the refactoring plan to address code quality issues in the llmux project.

### Root Cause

**"Provider" concept is defined differently in 3 packages (core/auth/server):**

| Package | Provider Concept | Issue |
|---------|------------------|-------|
| **core** | `BaseProvider` for format transformation | No endpoint/headers metadata |
| **auth** | `AuthProvider` for authentication (has getEndpoint/getHeaders) | **server ignores this and hardcodes it** |
| **server** | Used only as string/enum | PROVIDER_ENDPOINTS/buildHeaders defined redundantly in 3 places |

### Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           @llmux/server                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Handlers (thin wrapper)                                          │  │
│  │  - streaming.ts (~200 lines)                                      │  │
│  │  - proxy.ts (~150 lines)                                          │  │
│  │  - responses.ts (~200 lines)                                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ↓                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  routing/                                                          │  │
│  │  - model-router.ts (Single point for Model→Provider decision)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ↓                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  upstream/                                                         │  │
│  │  - client.ts (HTTP call, retry/429 handling)                      │  │
│  │  - endpoints.ts (Integrate PROVIDER_ENDPOINTS)                    │  │
│  │  - headers.ts (Integrate buildHeaders)                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ↓                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  providers/                                                        │  │
│  │  - antigravity.ts (Antigravity specific logic)                    │  │
│  │  - openai-web.ts (Codex specific logic)                           │  │
│  │  - opencode-zen.ts (Opencode-zen specific logic)                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           @llmux/auth                                    │
│  - AuthProvider Interface (getCredential, getHeaders, getEndpoint)      │
│  - Encapsulate Auth + Meta info for each Provider                       │
│  - ANTIGRAVITY_* constants used internally only                         │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           @llmux/core                                    │
│  - Pure format transformation (transformRequest, transformResponse)     │
│  - Provider implementation (OpenAI, Anthropic, Gemini, etc.)            │
│  - Streaming transformation (parseStreamChunk, transformStreamChunk)    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Identified Issues

### 🔴 High Severity

| Issue | Location | Description |
|-------|----------|-------------|
| **Dependency Inversion** | `streaming.ts:1-12`, `proxy.ts:1-9` | Directly importing internal constants (ANTIGRAVITY_*) from auth |
| **PROVIDER_ENDPOINTS Duplication** | `streaming.ts:186-194`, `proxy.ts:36-42`, `responses.ts:37-42` | Same constant defined in 3 places |
| **buildHeaders Duplication** | `streaming.ts:200-237`, `proxy.ts:51-88`, `responses.ts:44-66` | Same function defined in 3 places |

### 🟠 Medium Severity

| Issue | Location | Description |
|-------|----------|-------------|
| **Antigravity Specific Code** | `streaming.ts:39-48` | MODEL_ALIASES hardcoded in common handler |
| **Scattered Model→Provider Inference** | `server.ts:113-132`, `proxy.ts:107-124`, `openai-fallback.ts:95-102` | Same logic duplicated in multiple places |
| **File Size Exceeded** | `streaming.ts`(1641 lines), `proxy.ts`(782 lines), `server.ts`(682 lines) | Single Responsibility Principle violation |

### 🟡 Low Severity

| Issue | Location | Description |
|-------|----------|-------------|
| **Dead code** | `streaming.ts:46-48` | `applyAntigravityAlias` possibly unused |
| **Unused auth getEndpoint** | `auth/opencode-zen.ts:90-111` | Exists in auth but ignored by server |

---

## Phase Summary

| Phase | Description | Status | Estimated Time | Risk | Details |
|-------|-------------|--------|----------------|------|---------|
| 1 | Create upstream/ directory & extract common utils | ✅ Completed | 2-3 hours | 🟡 Medium | - |
| 2 | Separate Provider-specific Logic | ✅ Completed | 2-3 hours | 🟡 Medium | - |
| 3 | Integrate Model Routing (★ Leverage ModelLookup) | ✅ Completed | 2-3 hours | 🟠 High | [PHASE-3-PLAN.md](./PHASE-3-PLAN.md) |
| 4 | Handler Reduction and Cleanup | ✅ Completed | 2-3 hours | 🟡 Medium | [PHASE-4-PLAN.md](./PHASE-4-PLAN.md) |
| 5 | Refactoring Cleanup and Optimization | ✅ Completed | 2-3 hours | 🟡 Medium | [PHASE-5-PLAN.md](./PHASE-5-PLAN.md) |
| 6 | Proxy Handler Optimization | ✅ Completed | 1-2 hours | 🟡 Medium | [PHASE-6-PLAN.md](./PHASE-6-PLAN.md) |

---

## Phase 1: Create upstream/ directory & extract common utils

**Estimated Time:** 2-3 hours  
**Risk:** 🟡 Medium (Moving existing code)  
**Status:** ✅ Completed (2025-12-30)

### Goal

Integrate duplicated `PROVIDER_ENDPOINTS`, `buildHeaders`, `parseRetryAfterMs`, etc. into a single location.

### Current State Analysis

#### PROVIDER_ENDPOINTS Duplication Status

| Provider | streaming.ts | proxy.ts | responses.ts |
|----------|:------------:|:--------:|:------------:|
| openai | ✅ | ✅ | ✅ |
| anthropic | ✅ | ✅ | ✅ |
| gemini | ✅ | ✅ | ✅ |
| antigravity | ✅ (streaming) | ✅ (non-stream) | ❌ (via auth) |
| opencode-zen | ✅ | ✅ | ❌ |
| openai-web | ✅ | ❌ | ✅ |

- **Note**: Antigravity has different URLs for streaming vs non-streaming
  - streaming: `.../v1internal:streamGenerateContent?alt=sse`
  - non-stream: `.../V1internal`

#### buildHeaders Function Comparison

| Item | streaming.ts | proxy.ts | responses.ts |
|------|:------------:|:--------:|:------------:|
| Location | L200-237 | L51-88 | L44-65 |
| fromProtocol support | ✅ | ✅ | ❌ |
| anthropic | ✅ | ✅ | ✅ |
| openai | ✅ | ✅ | ✅ |
| gemini | ✅ | ✅ | ✅ |
| antigravity | ✅ | ✅ | ❌ |
| opencode-zen | ✅ | ✅ | ❌ |
| openai-web | ❌ | ❌ | ✅ |

- **Conclusion**: streaming/proxy functions are supersets, need to add openai-web support

#### parseRetryAfterMs Usage Status

| File | Role |
|------|------|
| streaming.ts (L50-73) | **Definition** |
| streaming.ts (L427-474) | Used in 429 handling |
| proxy.ts (L21) | Imported from streaming |
| responses.ts | ❌ Unused (provider fallback only) |

#### 429/Rate Limit Handling Pattern

| File | Pattern |
|------|------|
| streaming.ts | accountRotation + router fallback + parseRetryAfterMs |
| proxy.ts | Same pattern |
| responses.ts | provider-level fallback only (parseRetryAfterMs unused) |

### Tasks

#### 1.1 Create directory and skeleton

- [x] Create `packages/server/src/upstream/` directory
- [x] Create 5 files: `index.ts`, `endpoints.ts`, `headers.ts`, `retry.ts`, `client.ts`
- [x] Define types: `UpstreamProvider = ProviderName | 'openai-web' | 'opencode-zen'`

#### 1.2 endpoints.ts - Integrate PROVIDER_ENDPOINTS

**API Design:**
```typescript
export interface EndpointOptions {
  streaming?: boolean;
}

export function getDefaultEndpoint(
  provider: UpstreamProvider,
  options?: EndpointOptions
): string | undefined
```

**Implementation Details:**
- [x] Copy PROVIDER_ENDPOINTS values character by character (preserve behavior)
- [x] Branch Antigravity streaming/non-stream URL with `streaming` option
- [x] Modify streaming.ts: `getDefaultEndpoint(provider, { streaming: true })`
- [x] Modify proxy.ts: `getDefaultEndpoint(provider, { streaming: false })`
- [x] Modify responses.ts: `getDefaultEndpoint(provider, { streaming: isStreaming })`

**Tests:**
- [x] `getDefaultEndpoint('openai')` → chat completions URL
- [x] `getDefaultEndpoint('antigravity', { streaming: true })` → streaming URL
- [x] `getDefaultEndpoint('antigravity', { streaming: false })` → base URL

#### 1.3 headers.ts - Integrate buildHeaders

**API Design:**
```typescript
export interface BuildHeadersOptions {
  fromProtocol?: string; // for opencode-zen
}

export function buildUpstreamHeaders(
  targetProvider: UpstreamProvider,
  apiKey?: string,
  options?: BuildHeadersOptions
): Record<string, string>
```

**Implementation Details:**
- [x] Implement based on buildHeaders from streaming/proxy (superset)
- [x] Add openai-web case from responses.ts
- [x] Supported list: openai, openai-web, anthropic, gemini, antigravity, opencode-zen
- [x] Modify streaming.ts: `buildUpstreamHeaders(provider, apiKey, { fromProtocol })`

| **Preserve Behavior** | Copy URL/headers character by character, watch out for Antigravity case sensitivity |
| **Types** | Clean up gradually, allow `as` casts |
| **Circular Import** | Be careful when referencing core ProviderName |
| **Error Messages** | Minimize changes |

### Quality Gate

```bash
bun run build
bun run typecheck
bun run test
```

### Expected Result

```
packages/server/src/upstream/
├── index.ts          # Barrel export
├── endpoints.ts      # getDefaultEndpoint() - Integrated PROVIDER_ENDPOINTS
├── headers.ts        # buildUpstreamHeaders() - Integrated buildHeaders
├── retry.ts          # parseRetryAfterMs()
└── client.ts         # callUpstream() - Common fetch wrapper
```

### Changed File List

| File | Change |
|------|--------|
| `upstream/endpoints.ts` | **New** - Integrated PROVIDER_ENDPOINTS |
| `upstream/headers.ts` | **New** - Integrated buildHeaders |
| `upstream/retry.ts` | **New** - parseRetryAfterMs moved |
| `upstream/client.ts` | **New** - fetch wrapper |
| `upstream/index.ts` | **New** - Barrel export |
| `handlers/streaming.ts` | Remove local functions/constants, import upstream |
| `handlers/proxy.ts` | Remove local functions/constants, import upstream |
| `handlers/responses.ts` | Remove local functions/constants, import upstream |

---

## Phase 2: Separate Provider-specific Logic

**Estimated Time:** 2-3 hours  
**Risk:** 🟡 Medium  
**Status:** ✅ Completed (2026-01-01)

### Goal

Separate logic specific to Antigravity, OpenAI-web, and Opencode-zen into their own modules.

### Tasks

- [x] 2.1 Create `packages/server/src/providers/` directory
- [x] 2.2 Create `providers/antigravity.ts`
  - [x] Move `ANTIGRAVITY_MODEL_ALIASES`
  - [x] Move `applyAntigravityAlias`
  - [x] Add `isLicenseError`, `shouldFallbackToDefaultProject`
  - [x] Refactor to use ANTIGRAVITY_* constants from auth
- [x] 2.3 Create `providers/openai-web.ts`
  - [x] Move `transformToolsForCodex`
  - [x] Add `buildCodexBody`
  - [x] Integrate `getCodexInstructions` related logic
- [x] 2.4 Create `providers/opencode-zen.ts`
  - [x] Move `fixOpencodeZenBody`
  - [x] Move `stripBetaFields`
  - [x] Add `resolveOpencodeZenProtocol`, `getOpencodeZenEndpoint`
- [x] 2.5 Create `providers/index.ts` (Barrel export)
- [x] 2.6 Modify handlers to use providers/ modules

### Quality Gate

```bash
bun run build
bun run typecheck
bun run test
```

### Expected Result

```
packages/server/src/providers/
├── index.ts
├── antigravity.ts    # Antigravity specific logic
├── openai-web.ts     # Codex/OpenAI-web specific logic
└── opencode-zen.ts   # Opencode-zen specific logic
```

---

## Phase 3: Integrate Model Routing

**Estimated Time:** 2-3 hours  
**Risk:** 🟠 High (Routing logic change)  
**Status:** ✅ Completed (2026-01-01)  
**Detailed Plan:** [PHASE-3-PLAN.md](./PHASE-3-PLAN.md)

### Goal

Consolidate scattered Model→Provider inference logic into a single `ModelRouter` and **leverage existing `ModelLookup` infrastructure**.

### Key Improvements

- Use same data source (`ModelLookup`) as `/models` endpoint
- Determine provider based on actual API data instead of hardcoded prefixes
- Automatic reflection when adding new models to `fetchers/`

### Resolution Priority

1. Explicit provider suffix (`model:provider`)
2. Static config mapping (config file)
3. ★ **ModelLookup** (Same data as `/models` endpoint)
4. Prefix-based inference (fallback)
5. OpenAI credential fallback
6. Default provider

### Tasks

- [ ] 3.1 Create `routing/types.ts` - Common type definitions (Ref ModelLookup)
- [ ] 3.2 Create `routing/model-rules.ts` - Fallback prefix rules
- [ ] 3.3 Create `routing/model-router.ts` - **Integrate ModelLookup**
- [ ] 3.4 Integrate `ModelRouter` into existing `Router` class
- [ ] 3.5 `server.ts` - Remove `inferProvider()`, use `ModelRouter`
- [ ] 3.6 `openai-fallback.ts` - Remove `resolveOpenAIProvider`, `isOpenAIModel`
- [ ] 3.7 `responses.ts` - Completely remove `detectProviderFromModel`
- [ ] 3.8 `fallback.ts` - Direct `ModelLookup` usage → `ModelRouter` usage
- [ ] 3.9 Write tests

### Quality Gate

```bash
bun run build
bun run typecheck
bun run test
```

### Expected Result

```
packages/server/src/routing/
├── index.ts
├── types.ts           # Common types (Ref ModelLookup)
├── model-rules.ts     # Fallback prefix rules
├── model-router.ts    # Model→Provider Single Decision Point (★ Integrate ModelLookup)
└── router.ts          # Existing Router (Cooldown, Integrate ModelRouter)
```

### Improvements

| Area | Before | After |
|------|--------|-------|
| Provider Inference | Hardcoding scattered in 5 places | `ModelRouter` single point |
| Data Source | Prefix rules only | `/models` API data priority |
| Maintenance | Code change required for new models | Auto-reflected if added to `fetchers/` |

---

## Phase 4: Handler Reduction and Cleanup

**Estimated Time:** 2-3 hours  
**Risk:** 🟡 Medium  
**Status:** ⏳ Pending

### Goal

Reduce handlers to thin wrappers (Target: under 200 lines)

### Tasks

- [ ] 4.1 Refactor `streaming.ts`
  - [ ] Use upstream/, providers/, routing/ modules
  - [ ] Keep only handler logic, separate the rest
  - [ ] Goal: Under 200 lines
- [ ] 4.2 Refactor `proxy.ts`
  - [ ] Use upstream/, providers/, routing/ modules
  - [ ] Keep only handler logic, separate the rest
  - [ ] Goal: Under 150 lines
- [ ] 4.3 Refactor `responses.ts`
  - [ ] Use upstream/, providers/, routing/ modules
  - [ ] Keep only handler logic, separate the rest
  - [ ] Goal: Under 200 lines
- [ ] 4.4 Cleanup `server.ts`
  - [ ] Remove scattered logic
  - [ ] Keep only route registration
  - [ ] Goal: Under 400 lines
- [ ] 4.5 Remove Dead code
  - [ ] Check `applyAntigravityAlias` usage and remove
  - [ ] Remove unused imports
- [ ] 4.6 Final Test and Verification

### Quality Gate

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```

### Expected Result

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| streaming.ts | 1641 lines | ~200 lines | -88% |
| proxy.ts | 782 lines | ~150 lines | -81% |
| responses.ts | 526 lines | ~200 lines | -62% |
| server.ts | 682 lines | ~400 lines | -41% |

---

## Future Work (Phase 5+, Optional)

### Phase 5: Utilize auth interface (Long term)

- [ ] 5.1 Change server to use auth's `getEndpoint()`, `getHeaders()`
- [ ] 5.2 Convert upstream/endpoints.ts to be based on auth
- [ ] 5.3 Convert upstream/headers.ts to be based on auth

### Phase 6: Add core Provider meta (Long term)

- [ ] 6.1 Review abstraction of HTTP endpoint/headers meta in core Provider
- [ ] 6.2 Fully implement Hub-and-Spoke pattern from PLAN.md

---

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regression due to routing logic change | 🔴 High | Run tests for each Phase, add smoke tests |
| Existing behavior change | 🟠 Medium | Change structure without changing behavior |
| Type mismatch | 🟡 Low | Must pass typecheck |

---

## Verification Scenarios

Test the following scenarios after completing each Phase:

1. **OpenAI Call**: `/v1/chat/completions` → OpenAI API
2. **Anthropic Call**: `/v1/messages` → Anthropic API
3. **Gemini Call**: `/v1/generateContent` → Gemini API
4. **Antigravity Call**: streaming + license fallback
5. **Opencode-zen Call**: claude/gpt-5/gemini-3/glm each test
6. **OpenAI-web Call**: Codex endpoint + headers
7. **Streaming**: SSE streaming for each provider

---

## Notes

*(Records during implementation)*
