# llmux Amp Basic Support Implementation Plan

**Version:** 1.0  
**Created:** 2025-12-25  
**Last Updated:** 2025-12-25  
**Status:** ✅ Complete  
**Language:** TypeScript + Bun  
**Approach:** TDD (Test-Driven Development)

---

## Overview

Add Amp CLI compatible API support to the llmux server. Model mapping system and Gemini Bridge are deferred to follow-up tasks, focusing on basic Amp routing support.

### Goals

1. **Extend Router**: Support Path parameters (`:provider`) and wildcards (`*path`).
2. **Provider Alias Route**: Support `/api/provider/:provider/v1/*` pattern.
3. **Upstream Proxy**: Fallback proxy to ampcode.com.
4. **FallbackHandler**: Route to upstream when no local provider exists.

### Out of Scope (Follow-up)

- ❌ Model Mapping System
- ❌ Gemini Bridge (`/publishers/google/models/...`)
- ❌ Response Rewriter (Rewrite model name)
- ❌ Admin Routes (`/api/user`, `/api/auth`, etc.)

---

## Phase Summary

| Phase | Description | Status | Estimated Time |
|-------|-------------|--------|----------------|
| 1 | Extend Router (Path Params + Wildcards) | ✅ Complete | 2h |
| 2 | Implement Upstream Proxy | ✅ Complete | 1.5h |
| 3 | Implement FallbackHandler | ✅ Complete | 2h |
| 4 | Register Provider Alias Routes | ✅ Complete | 1.5h |
| 5 | Integration Testing and Documentation | ✅ Complete | 1h |

**Total Estimated Time:** 8 hours

---

## Phase 1: Extend Router (Path Params + Wildcards)

**Status:** ✅ Complete  
**Risk Level:** 🟡 Medium  
**Estimated Time:** 2 hours

### Goal

Extend the router which currently supports exact match only to support:
- Path parameters: `/api/provider/:provider/v1/chat/completions`
- Wildcards: `/v1beta/models/*action`

### TDD Tasks

#### 1.1 Extend Type Definition (Test First)

- [ ] **Test**: `router.test.ts` - Test Route type params support
  ```typescript
  // Test: Verify params are passed to handler
  it('should pass path params to handler', async () => {
    const routes: Route[] = [{
      method: 'GET',
      path: '/api/provider/:provider/models',
      handler: async (req, params) => {
        expect(params.provider).toBe('openai')
        return new Response('ok')
      }
    }]
    const router = createRouter(routes)
    const res = await router(new Request('http://localhost/api/provider/openai/models'))
    expect(res.status).toBe(200)
  })
  ```
- [ ] **Impl**: Add `params` support to `Route` interface

#### 1.2 Implement Path Parameter Matching

- [ ] **Test**: Single param match test
  ```typescript
  it('should match :param pattern', async () => {
    // /users/:id → /users/123 match
  })
  ```
- [ ] **Test**: Multiple params match test
  ```typescript
  it('should match multiple :params', async () => {
    // /api/:provider/v1/:endpoint → /api/openai/v1/chat match
  })
  ```
- [ ] **Impl**: Implement `matchPath()` function - param extraction logic

#### 1.3 Implement Wildcard Matching

- [ ] **Test**: wildcard match test
  ```typescript
  it('should match *wildcard pattern', async () => {
    // /v1beta/models/*action → /v1beta/models/gemini-pro:generateContent
  })
  ```
- [ ] **Test**: wildcard captures entire remaining path
  ```typescript
  it('should capture rest of path in wildcard', async () => {
    // /files/*path → /files/a/b/c.txt → params.path = 'a/b/c.txt'
  })
  ```
- [ ] **Impl**: Add wildcard pattern matching logic

#### 1.4 Integrate Router

- [ ] **Test**: Priority test (exact > param > wildcard)
  ```typescript
  it('should prioritize exact match over param match', async () => {
    // /api/health (exact) vs /api/:resource (param)
  })
  ```
- [ ] **Impl**: Refactor `createRouter()` function

### Quality Gate

```bash
bun test packages/server/test/router.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/router.ts` - Extended router
- `packages/server/test/router.test.ts` - Router tests (15+ tests)

---

## Phase 2: Implement Upstream Proxy

**Status:** ✅ Complete  
**Risk Level:** 🟢 Low  
**Estimated Time:** 1.5 hours

### Goal

Implement proxy function to forward requests to ampcode.com.

### TDD Tasks

#### 2.1 Define Proxy Type

- [ ] **Test**: `proxy.test.ts` - ProxyConfig type test
  ```typescript
  it('should create proxy with valid config', () => {
    const proxy = createUpstreamProxy({
      targetUrl: 'https://api.ampcode.com',
      apiKey: 'test-key'
    })
    expect(proxy).toBeDefined()
  })
  ```
- [ ] **Impl**: Define `ProxyConfig` interface

#### 2.2 Implement Request Forwarding

- [ ] **Test**: Forward request headers/body test
  ```typescript
  it('should forward request headers and body', async () => {
    // Verify X-Api-Key, Authorization injection
  })
  ```
- [ ] **Test**: Auth header replacement test
  ```typescript
  it('should replace auth headers with upstream credentials', async () => {
    // Remove client Authorization, inject upstream API key
  })
  ```
- [ ] **Impl**: Implement `proxyRequest()` function

#### 2.3 Implement Response Forwarding

- [ ] **Test**: Response streaming forwarding test
  ```typescript
  it('should stream SSE response from upstream', async () => {
    // Pass through text/event-stream response
  })
  ```
- [ ] **Test**: Error response handling test
  ```typescript
  it('should handle upstream errors gracefully', async () => {
    // Return 502 Bad Gateway
  })
  ```
- [ ] **Impl**: Response streaming processing

#### 2.4 Gzip Handling

- [ ] **Test**: gzip response decoding test
  ```typescript
  it('should decompress gzip responses if needed', async () => {
    // Handle Content-Encoding: gzip
  })
  ```
- [ ] **Impl**: Gzip auto-detection and handling

### Quality Gate

```bash
bun test packages/server/test/proxy.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/upstream/proxy.ts` - Upstream Proxy
- `packages/server/src/upstream/index.ts` - Module exports
- `packages/server/test/upstream/proxy.test.ts` - Proxy tests (10+ tests)

---

## Phase 3: Implement FallbackHandler

**Status:** ✅ Complete  
**Risk Level:** 🟡 Medium  
**Estimated Time:** 2 hours

### Goal

Implement a handler wrapper that automatically falls back to upstream when no local provider exists.

### TDD Tasks

#### 3.1 Define FallbackHandler Type

- [ ] **Test**: `fallback.test.ts` - FallbackHandler creation test
  ```typescript
  it('should create fallback handler with proxy getter', () => {
    const fallback = new FallbackHandler(() => mockProxy)
    expect(fallback).toBeDefined()
  })
  ```
- [ ] **Impl**: Define `FallbackHandler` class

#### 3.2 Model Extraction Logic

- [ ] **Test**: Extract model from JSON body
  ```typescript
  it('should extract model from JSON body', async () => {
    const body = JSON.stringify({ model: 'gpt-4o', messages: [] })
    const model = await extractModel(new Request('...', { body }))
    expect(model).toBe('gpt-4o')
  })
  ```
- [ ] **Test**: Extract model from URL path (Gemini style)
  ```typescript
  it('should extract model from URL path', () => {
    // /models/gemini-pro:generateContent → 'gemini-pro'
  })
  ```
- [ ] **Impl**: Implement `extractModel()` function

#### 3.3 Provider Check Logic

- [ ] **Test**: Check local provider availability
  ```typescript
  it('should detect local provider availability', () => {
    // Check available provider by model name
  })
  ```
- [ ] **Impl**: Implement `hasLocalProvider()` function (Integrate with llmux/core)

#### 3.4 Fallback Decision Logic

- [ ] **Test**: Use local handler if local provider exists
  ```typescript
  it('should use local handler when provider available', async () => {
    // Verify local handler call
  })
  ```
- [ ] **Test**: Proxy to upstream if no local provider
  ```typescript
  it('should proxy to upstream when no local provider', async () => {
    // Verify upstream proxy call
  })
  ```
- [ ] **Test**: Return error if upstream is also missing
  ```typescript
  it('should return error when no provider and no proxy', async () => {
    // 503 Service Unavailable
  })
  ```
- [ ] **Impl**: Implement `wrapHandler()` method

#### 3.5 Handler Wrapping

- [ ] **Test**: Wrapped handler works correctly
  ```typescript
  it('should wrap handler with fallback logic', async () => {
    const wrapped = fallback.wrap(originalHandler)
    // Verify normal operation after wrapping
  })
  ```
- [ ] **Impl**: Complete `wrap()` method

### Quality Gate

```bash
bun test packages/server/test/fallback.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/handlers/fallback.ts` - FallbackHandler
- `packages/server/test/handlers/fallback.test.ts` - Tests (12+ tests)

---

## Phase 4: Register Provider Alias Routes

**Status:** ✅ Complete  
**Risk Level:** 🟡 Medium  
**Estimated Time:** 1.5 hours

### Goal

Register Amp compatible routes matching `/api/provider/:provider/v1/*` pattern.

### TDD Tasks

#### 4.1 Define Amp Routes

- [ ] **Test**: `amp-routes.test.ts` - Route list generation test
  ```typescript
  it('should create amp provider routes', () => {
    const routes = createAmpRoutes(baseHandler, fallbackHandler)
    expect(routes).toContainEqual(
      expect.objectContaining({ path: '/api/provider/:provider/v1/chat/completions' })
    )
  })
  ```
- [ ] **Impl**: Define `createAmpRoutes()` function

#### 4.2 Route Handler by Provider

- [ ] **Test**: Handler selection by provider parameter
  ```typescript
  it('should route to OpenAI handler for openai provider', async () => {
    // /api/provider/openai/v1/chat/completions → OpenAI handler
  })
  it('should route to Anthropic handler for anthropic provider', async () => {
    // /api/provider/anthropic/v1/messages → Anthropic handler
  })
  it('should route to Gemini handler for google provider', async () => {
    // /api/provider/google/v1beta/models/* → Gemini handler
  })
  ```
- [ ] **Impl**: Provider-specific handler mapping logic

#### 4.3 Models Endpoint

- [ ] **Test**: /models endpoint routing
  ```typescript
  it('should return provider-specific models list', async () => {
    // /api/provider/openai/models → OpenAI model list
  })
  ```
- [ ] **Impl**: Unified model list handler

#### 4.4 Server Integration

- [ ] **Test**: Register Amp routes on server
  ```typescript
  it('should register amp routes on server startup', async () => {
    const server = await startServer({ enableAmp: true })
    // Verify /api/provider/openai/v1/chat/completions response
  })
  ```
- [ ] **Impl**: Integrate Amp routes into `startServer()` function

#### 4.5 Apply FallbackHandler

- [ ] **Test**: Apply fallback to all POST endpoints
  ```typescript
  it('should apply fallback handler to POST endpoints', async () => {
    // Verify upstream proxy when no local provider
  })
  ```
- [ ] **Impl**: Wrap POST handlers with FallbackHandler

### Quality Gate

```bash
bun test packages/server/test/amp-routes.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/amp/routes.ts` - Amp Route definitions
- `packages/server/src/amp/index.ts` - Module exports
- `packages/server/test/amp/routes.test.ts` - Route tests (10+ tests)

---

## Phase 5: Integration Testing and Documentation

**Status:** ✅ Complete  
**Risk Level:** 🟢 Low  
**Estimated Time:** 1 hour

### Goal

Write End-to-end integration tests and usage documentation.

### TDD Tasks

#### 5.1 E2E Integration Tests

- [ ] **Test**: Full flow test
  ```typescript
  it('should handle amp request end-to-end', async () => {
    // Start server → Amp request → Verify response
  })
  ```
- [ ] **Test**: Local provider usage E2E
  ```typescript
  it('should use local provider when available', async () => {
    // Set API key → Verify local processing
  })
  ```
- [ ] **Test**: Upstream fallback E2E
  ```typescript
  it('should fallback to upstream when no local provider', async () => {
    // No local provider → Verify upstream proxy
  })
  ```

#### 5.2 Documentation

- [ ] **Doc**: Add Amp support section to README.md
- [ ] **Doc**: Config example (`config.yaml`)
- [ ] **Doc**: API endpoint list

#### 5.3 Example Code

- [ ] **Example**: Amp CLI integration example
- [ ] **Example**: Config file example

### Quality Gate

```bash
bun test packages/server/test/
bun run typecheck
bun run build
```

### Deliverables

- `packages/server/test/integration/amp.test.ts` - Integration tests
- Update `llmux/README.md`
- `llmux/examples/amp-config.yaml` - Config example

---

## Success Criteria

1. ✅ Router correctly matches path params and wildcards.
2. ✅ Upstream proxy correctly forwards requests/responses.
3. ✅ FallbackHandler correctly routes based on provider availability.
4. ✅ `/api/provider/:provider/v1/*` routes work.
5. ✅ All tests passed (50+ tests).
6. ✅ TypeScript type checks passed.

---

## Follow-up Tasks (Next Plan)

Features to be added after this plan:

1. **Model Mapping System** - Model aliases and fallback chain
2. **Gemini Bridge** - Support `/publishers/google/models/...` path
3. **Response Rewriter** - Rewrite model names in response
4. **Admin Routes** - `/api/user`, `/api/auth`, `/threads`, etc.
5. **Hot Reload** - Dynamic reloading on config change

---

## Notes

### Implementation Notes
*(Records during implementation)*
