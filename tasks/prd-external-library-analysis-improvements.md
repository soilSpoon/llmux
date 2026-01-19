# PRD: External Library Analysis Improvements

## Introduction

Implement key recommendations derived from analyzing recent changes in related open-source AI libraries (AI SDK, LiteLLM, OpenCode, etc.). This initiative aims to enhance the stability, compatibility, and resource management of the `llmux` proxy server, focusing on structured outputs, API resilience, and memory safety.

## Goals

- Enable reliable structured JSON extraction from AI models (aligning with Vercel AI SDK patterns)
- Proactively safeguard against potential Google/Antigravity API changes
- Prevent Out-Of-Memory (OOM) crashes during long-running or high-volume streaming sessions

## User Stories

### US-001: Native "Structured Output" Support
**Description:** As a developer, I want to request JSON-structured responses from Google and Anthropic models using a standardized `response_format` parameter so that I can reliably extract data without parsing raw text.

**Acceptance Criteria:**
- [ ] `@llmux/core` transforms `response_format: { type: "json_schema", ... }` into provider-specific parameters
    - Google: Maps to `responseMimeType: "application/json"` and `responseSchema`
    - Anthropic: Maps to tool use enforcement or native JSON mode (if available)
- [ ] Validates schema structure before sending to provider
- [ ] Typecheck passes (`bun run typecheck`)
- [ ] Verify with a test request requesting specific JSON schema output

### US-002: Google Antigravity Auth API Hardening
**Description:** As a system administrator, I want the system to handle potential Google API changes gracefully so that service interruption is minimized if endpoints or auth flows change.

**Acceptance Criteria:**
- [ ] Add specific error handling for 404/403 errors in `fetchAntigravityProjectID`
- [ ] Implement a configurable fallback URL mechanism for Antigravity auth endpoints
- [ ] Add detailed logging for auth-related failures to aid rapid debugging
- [ ] Typecheck passes

### US-003: Large Stream Memory Protection (Soft Limits)
**Description:** As an operator, I want the system to stop accumulating logs or cache for extremely large streams so that the server doesn't crash with OOM errors during infinite loops or massive generations.

**Acceptance Criteria:**
- [ ] Define a configurable `MAX_STREAM_BUFFER_SIZE` (default ~100MB)
- [ ] In `stream-transformer.ts`, stop appending to `fullResponse` and `accumulatedText` once limit is reached
- [ ] Log a warning when the limit is hit ("Stream buffer limit reached, truncation enabled")
- [ ] Ensure the actual stream to the client continues uninterrupted (only internal buffering stops)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: **Unified JSON Schema**: The system must accept an OpenAI-compatible `json_schema` definition and convert it to the appropriate format for the target provider.
- FR-2: **Auth Fallback**: The Antigravity provider must attempt a secondary/hardcoded endpoint if the primary Project ID lookup fails.
- FR-3: **Stream Truncation**: The `StreamContext` accumulation logic must check current buffer size before appending new chunks.

## Non-Goals

- Implementation of new providers (Manus, Azure Flux)
- Client-side timeouts (unless already handled by upstream layer)
- Retrofitting structured output support for legacy models that don't support JSON mode

## Technical Considerations

- **Structured Output**: Google's `responseSchema` is strict; we may need a utility to convert simplified JSON schemas to the specific subset Google supports.
- **Memory Safety**: `StreamContext` holds the full string for logging. For very large streams, we might only want to keep the *first* N bytes and *last* N bytes for logs, dropping the middle.
- **Config**: New limits and fallbacks should be added to `config.json` or environment variables where appropriate.

## Success Metrics

- 99.9% reliability in JSON structure generation for supported models
- Zero OOM crashes reported due to log buffering of large streams
- Graceful degradation (warning log instead of crash) if Google Auth API returns 404

## Open Questions

- Should we use a library like `zod-to-json-schema` if users provide Zod schemas, or assume raw JSON schema input? (Assumption: Raw JSON schema for proxy level)
- What is the exact byte limit for "safe" logging in our current deployment environment? (Proposed: 50MB-100MB)
