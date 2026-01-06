# Research: Provider Schema Refactor

**Status**: ✅ Complete
**Date**: 2026-01-06

## Overview

All schema research has been completed and documented in the `schemas/` directory. This document summarizes key decisions and findings.

## Research Tasks Completed

### 1. Schema Analysis (All Providers)

| Provider | Status | Documentation |
|----------|--------|---------------|
| OpenAI Chat | ✅ Complete | [schemas/openai-chat.md](schemas/openai-chat.md) |
| OpenAI Responses | ✅ Complete | [schemas/openai-responses.md](schemas/openai-responses.md) |
| Anthropic Messages | ✅ Complete | [schemas/anthropic-messages.md](schemas/anthropic-messages.md) |
| Google Gemini | ✅ Complete | [schemas/google-gemini.md](schemas/google-gemini.md) |
| Unified (Hub) | ✅ Complete | [schemas/unified.md](schemas/unified.md) |

### 2. Best Practices Research

| Topic | Decision | Rationale | Alternatives Rejected |
|-------|----------|-----------|----------------------|
| Tool arguments storage | Object (not string) | Anthropic/Gemini use objects natively; stringify only for OpenAI wire format | Store as string (requires extra parsing for most providers) |
| Default max_tokens | 4096 | Same as LiteLLM; safe default that works across models | Model max (cost risk), 8192 (still too large for some), Error (bad DX) |
| Lossy transform handling | Strip + warn | Maintains compatibility while providing observability | Error (too strict), Silent strip (no debugging) |
| Streaming error handling | Error chunk + close | Client receives partial results + error notification | Immediate close (loses partial data), Continue with placeholders (data corruption) |
| Unknown model format | Error (no fallback) | Explicit failures prevent silent incorrect behavior | Fallback to default (masks configuration errors) |

### 3. Critical Implementation Patterns

#### 3.1 Type Guard Pattern for Format Detection

```typescript
// Each format implements isSupportedWireRequest to detect its wire format
isSupportedWireRequest(req: unknown): boolean {
  if (!req || typeof req !== 'object') return false
  const r = req as Record<string, unknown>
  // OpenAI Chat: has 'messages', no 'input'
  return typeof r.model === 'string' && Array.isArray(r.messages) && !('input' in r)
}
```

#### 3.2 Round-Trip Test Pattern

```typescript
it('preserves data through round-trip', () => {
  const original = { /* wire format */ }
  const unified = Format.parseRequest(original)
  const rebuilt = Format.buildWireRequest(unified, ctx)
  expect(rebuilt).toEqual(original)
})
```

#### 3.3 Cross-Format Transformation

```typescript
// A → Unified → B transformation
const unified = FormatA.parseRequest(wireA)
const wireB = FormatB.buildWireRequest(unified, ctx)
// Note: Some data may be lost (cache_control, thinking, etc.)
// Must log warnings for lossy transforms
```

## Key Findings Summary

### Critical Differences Between Formats

| Aspect | OpenAI Chat | OpenAI Responses | Anthropic | Gemini |
|--------|-------------|------------------|-----------|--------|
| Assistant role | `assistant` | `assistant` | `assistant` | **`model`** |
| Text type (user) | `text` | **`input_text`** | `text` | `{ text }` |
| Tool arguments | JSON string | JSON string | **object** | **object** |
| Tool schema field | `parameters` | `parameters` | **`input_schema`** | `parameters` |
| System prompt | in messages | `instructions` | separate `system` | `systemInstruction` |
| max_tokens | optional | optional | **required** | optional |
| Content format | string or array | array | **always array** | array |

### Transformation Gotchas

1. **Anthropic arguments are objects** - Must JSON.parse when parsing OpenAI, JSON.stringify when building OpenAI
2. **Gemini role is `model`** - Easy to miss, causes silent failures
3. **OpenAI Responses type names differ** - `input_text`/`output_text` not `text`
4. **Anthropic max_tokens required** - Use 4096 default
5. **Anthropic content always array** - Never just a string

## Dependencies Identified

None new. This is an internal refactor using existing infrastructure:
- Bun runtime
- TypeScript 5.x
- Existing provider implementations (to extract logic from)

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing providers | Medium | High | Comprehensive existing tests; run after each change |
| Missing edge cases | Medium | Medium | 70+ test cases documented in test-cases.md |
| Performance regression | Low | Medium | Add streaming latency benchmarks |
| Type safety gaps | Low | High | Strict TypeScript, no `any` |

## Next Steps

→ Proceed to Phase 1: Implementation (interface definition, format implementations)

See [plan.md](plan.md) Phase 2-6 for detailed implementation steps.
