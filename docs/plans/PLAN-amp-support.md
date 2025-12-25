# llmux Amp 기본 지원 구현 계획

**Version:** 1.0  
**Created:** 2025-12-25  
**Last Updated:** 2025-12-25  
**Status:** ✅ Complete  
**Language:** TypeScript + Bun  
**Approach:** TDD (Test-Driven Development)

---

## 개요

llmux 서버에 Amp CLI 호환 API 지원을 추가합니다. 모델 매핑 시스템과 Gemini Bridge는 후속 작업으로 미루고, 기본적인 Amp 라우팅 지원에 집중합니다.

### 목표

1. **라우터 확장**: Path parameters (`:provider`) 및 wildcards (`*path`) 지원
2. **Provider Alias 라우트**: `/api/provider/:provider/v1/*` 패턴 지원
3. **Upstream Proxy**: ampcode.com으로 fallback 프록시
4. **FallbackHandler**: 로컬 provider 없을 때 upstream으로 라우팅

### 제외 범위 (후속 작업)

- ❌ Model Mapping 시스템
- ❌ Gemini Bridge (`/publishers/google/models/...`)
- ❌ Response Rewriter (모델명 재작성)
- ❌ 관리 라우트 (`/api/user`, `/api/auth` 등)

---

## Phase Summary

| Phase | Description | Status | Estimated Time |
|-------|-------------|--------|----------------|
| 1 | 라우터 확장 (Path Params + Wildcards) | ✅ Complete | 2h |
| 2 | Upstream Proxy 구현 | ✅ Complete | 1.5h |
| 3 | FallbackHandler 구현 | ✅ Complete | 2h |
| 4 | Provider Alias 라우트 등록 | ✅ Complete | 1.5h |
| 5 | 통합 테스트 및 문서화 | ✅ Complete | 1h |

**Total Estimated Time:** 8 hours

---

## Phase 1: 라우터 확장 (Path Params + Wildcards)

**Status:** ✅ Complete  
**Risk Level:** 🟡 Medium  
**Estimated Time:** 2 hours

### 목표

현재 exact match만 지원하는 라우터를 확장하여:
- Path parameters: `/api/provider/:provider/v1/chat/completions`
- Wildcards: `/v1beta/models/*action`

### TDD Tasks

#### 1.1 타입 정의 확장 (테스트 먼저)

- [ ] **Test**: `router.test.ts` - Route 타입에 params 지원 테스트
  ```typescript
  // 테스트: params가 handler에 전달되는지 확인
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
- [ ] **Impl**: `Route` 인터페이스에 `params` 지원 추가

#### 1.2 Path Parameter 매칭 구현

- [ ] **Test**: 단일 param 매칭 테스트
  ```typescript
  it('should match :param pattern', async () => {
    // /users/:id → /users/123 매칭
  })
  ```
- [ ] **Test**: 다중 param 매칭 테스트
  ```typescript
  it('should match multiple :params', async () => {
    // /api/:provider/v1/:endpoint → /api/openai/v1/chat 매칭
  })
  ```
- [ ] **Impl**: `matchPath()` 함수 구현 - param 추출 로직

#### 1.3 Wildcard 매칭 구현

- [ ] **Test**: wildcard 매칭 테스트
  ```typescript
  it('should match *wildcard pattern', async () => {
    // /v1beta/models/*action → /v1beta/models/gemini-pro:generateContent
  })
  ```
- [ ] **Test**: wildcard가 나머지 경로 전체 캡처
  ```typescript
  it('should capture rest of path in wildcard', async () => {
    // /files/*path → /files/a/b/c.txt → params.path = 'a/b/c.txt'
  })
  ```
- [ ] **Impl**: wildcard 패턴 매칭 로직 추가

#### 1.4 라우터 통합

- [ ] **Test**: 우선순위 테스트 (exact > param > wildcard)
  ```typescript
  it('should prioritize exact match over param match', async () => {
    // /api/health (exact) vs /api/:resource (param)
  })
  ```
- [ ] **Impl**: `createRouter()` 함수 리팩토링

### Quality Gate

```bash
bun test packages/server/test/router.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/router.ts` - 확장된 라우터
- `packages/server/test/router.test.ts` - 라우터 테스트 (15+ tests)

---

## Phase 2: Upstream Proxy 구현

**Status:** ✅ Complete  
**Risk Level:** 🟢 Low  
**Estimated Time:** 1.5 hours

### 목표

ampcode.com으로 요청을 프록시하는 기능 구현

### TDD Tasks

#### 2.1 Proxy 타입 정의

- [ ] **Test**: `proxy.test.ts` - ProxyConfig 타입 테스트
  ```typescript
  it('should create proxy with valid config', () => {
    const proxy = createUpstreamProxy({
      targetUrl: 'https://api.ampcode.com',
      apiKey: 'test-key'
    })
    expect(proxy).toBeDefined()
  })
  ```
- [ ] **Impl**: `ProxyConfig` 인터페이스 정의

#### 2.2 요청 전달 구현

- [ ] **Test**: 요청 헤더/바디 전달 테스트
  ```typescript
  it('should forward request headers and body', async () => {
    // X-Api-Key, Authorization 주입 확인
  })
  ```
- [ ] **Test**: 인증 헤더 교체 테스트
  ```typescript
  it('should replace auth headers with upstream credentials', async () => {
    // 클라이언트의 Authorization 제거, upstream API key 주입
  })
  ```
- [ ] **Impl**: `proxyRequest()` 함수 구현

#### 2.3 응답 전달 구현

- [ ] **Test**: 응답 스트리밍 전달 테스트
  ```typescript
  it('should stream SSE response from upstream', async () => {
    // text/event-stream 응답 그대로 전달
  })
  ```
- [ ] **Test**: 에러 응답 처리 테스트
  ```typescript
  it('should handle upstream errors gracefully', async () => {
    // 502 Bad Gateway 반환
  })
  ```
- [ ] **Impl**: 응답 스트리밍 처리

#### 2.4 gzip 처리

- [ ] **Test**: gzip 응답 디코딩 테스트
  ```typescript
  it('should decompress gzip responses if needed', async () => {
    // Content-Encoding: gzip 처리
  })
  ```
- [ ] **Impl**: gzip 자동 감지 및 처리

### Quality Gate

```bash
bun test packages/server/test/proxy.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/upstream/proxy.ts` - Upstream 프록시
- `packages/server/src/upstream/index.ts` - 모듈 exports
- `packages/server/test/upstream/proxy.test.ts` - 프록시 테스트 (10+ tests)

---

## Phase 3: FallbackHandler 구현

**Status:** ✅ Complete  
**Risk Level:** 🟡 Medium  
**Estimated Time:** 2 hours

### 목표

로컬 provider가 없을 때 upstream으로 자동 fallback하는 핸들러 래퍼 구현

### TDD Tasks

#### 3.1 FallbackHandler 타입 정의

- [ ] **Test**: `fallback.test.ts` - FallbackHandler 생성 테스트
  ```typescript
  it('should create fallback handler with proxy getter', () => {
    const fallback = new FallbackHandler(() => mockProxy)
    expect(fallback).toBeDefined()
  })
  ```
- [ ] **Impl**: `FallbackHandler` 클래스 정의

#### 3.2 모델 추출 로직

- [ ] **Test**: JSON body에서 model 추출
  ```typescript
  it('should extract model from JSON body', async () => {
    const body = JSON.stringify({ model: 'gpt-4o', messages: [] })
    const model = await extractModel(new Request('...', { body }))
    expect(model).toBe('gpt-4o')
  })
  ```
- [ ] **Test**: URL path에서 model 추출 (Gemini 스타일)
  ```typescript
  it('should extract model from URL path', () => {
    // /models/gemini-pro:generateContent → 'gemini-pro'
  })
  ```
- [ ] **Impl**: `extractModel()` 함수 구현

#### 3.3 Provider 확인 로직

- [ ] **Test**: 로컬 provider 존재 확인
  ```typescript
  it('should detect local provider availability', () => {
    // 모델명으로 사용 가능한 provider 확인
  })
  ```
- [ ] **Impl**: `hasLocalProvider()` 함수 구현 (llmux/core 연동)

#### 3.4 Fallback 결정 로직

- [ ] **Test**: 로컬 provider 있으면 로컬 처리
  ```typescript
  it('should use local handler when provider available', async () => {
    // 로컬 handler 호출 확인
  })
  ```
- [ ] **Test**: 로컬 provider 없으면 upstream 프록시
  ```typescript
  it('should proxy to upstream when no local provider', async () => {
    // upstream proxy 호출 확인
  })
  ```
- [ ] **Test**: upstream도 없으면 에러 반환
  ```typescript
  it('should return error when no provider and no proxy', async () => {
    // 503 Service Unavailable
  })
  ```
- [ ] **Impl**: `wrapHandler()` 메서드 구현

#### 3.5 핸들러 래핑

- [ ] **Test**: 래핑된 핸들러가 올바르게 동작
  ```typescript
  it('should wrap handler with fallback logic', async () => {
    const wrapped = fallback.wrap(originalHandler)
    // 래핑 후에도 정상 동작 확인
  })
  ```
- [ ] **Impl**: `wrap()` 메서드 완성

### Quality Gate

```bash
bun test packages/server/test/fallback.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/handlers/fallback.ts` - FallbackHandler
- `packages/server/test/handlers/fallback.test.ts` - 테스트 (12+ tests)

---

## Phase 4: Provider Alias 라우트 등록

**Status:** ✅ Complete  
**Risk Level:** 🟡 Medium  
**Estimated Time:** 1.5 hours

### 목표

`/api/provider/:provider/v1/*` 패턴의 Amp 호환 라우트 등록

### TDD Tasks

#### 4.1 Amp 라우트 정의

- [ ] **Test**: `amp-routes.test.ts` - 라우트 목록 생성 테스트
  ```typescript
  it('should create amp provider routes', () => {
    const routes = createAmpRoutes(baseHandler, fallbackHandler)
    expect(routes).toContainEqual(
      expect.objectContaining({ path: '/api/provider/:provider/v1/chat/completions' })
    )
  })
  ```
- [ ] **Impl**: `createAmpRoutes()` 함수 정의

#### 4.2 Provider별 핸들러 라우팅

- [ ] **Test**: provider 파라미터에 따른 핸들러 선택
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
- [ ] **Impl**: provider별 핸들러 매핑 로직

#### 4.3 Models 엔드포인트

- [ ] **Test**: /models 엔드포인트 라우팅
  ```typescript
  it('should return provider-specific models list', async () => {
    // /api/provider/openai/models → OpenAI 모델 목록
  })
  ```
- [ ] **Impl**: 통합 모델 목록 핸들러

#### 4.4 서버 통합

- [ ] **Test**: 서버에 Amp 라우트 등록
  ```typescript
  it('should register amp routes on server startup', async () => {
    const server = await startServer({ enableAmp: true })
    // /api/provider/openai/v1/chat/completions 응답 확인
  })
  ```
- [ ] **Impl**: `startServer()` 함수에 Amp 라우트 통합

#### 4.5 FallbackHandler 적용

- [ ] **Test**: 모든 POST 엔드포인트에 fallback 적용
  ```typescript
  it('should apply fallback handler to POST endpoints', async () => {
    // 로컬 provider 없을 때 upstream 프록시 확인
  })
  ```
- [ ] **Impl**: POST 핸들러들에 FallbackHandler 래핑

### Quality Gate

```bash
bun test packages/server/test/amp-routes.test.ts
bun run typecheck
```

### Deliverables

- `packages/server/src/amp/routes.ts` - Amp 라우트 정의
- `packages/server/src/amp/index.ts` - 모듈 exports
- `packages/server/test/amp/routes.test.ts` - 라우트 테스트 (10+ tests)

---

## Phase 5: 통합 테스트 및 문서화

**Status:** ✅ Complete  
**Risk Level:** 🟢 Low  
**Estimated Time:** 1 hour

### 목표

End-to-end 통합 테스트 및 사용 문서 작성

### TDD Tasks

#### 5.1 E2E 통합 테스트

- [ ] **Test**: 전체 흐름 테스트
  ```typescript
  it('should handle amp request end-to-end', async () => {
    // 서버 시작 → Amp 요청 → 응답 확인
  })
  ```
- [ ] **Test**: 로컬 provider 사용 E2E
  ```typescript
  it('should use local provider when available', async () => {
    // API key 설정 → 로컬 처리 확인
  })
  ```
- [ ] **Test**: Upstream fallback E2E
  ```typescript
  it('should fallback to upstream when no local provider', async () => {
    // 로컬 provider 없음 → upstream 프록시 확인
  })
  ```

#### 5.2 문서화

- [ ] **Doc**: README.md에 Amp 지원 섹션 추가
- [ ] **Doc**: 설정 예제 (`config.yaml`)
- [ ] **Doc**: API 엔드포인트 목록

#### 5.3 예제 코드

- [ ] **Example**: Amp CLI 연동 예제
- [ ] **Example**: 설정 파일 예제

### Quality Gate

```bash
bun test packages/server/test/
bun run typecheck
bun run build
```

### Deliverables

- `packages/server/test/integration/amp.test.ts` - 통합 테스트
- `llmux/README.md` 업데이트
- `llmux/examples/amp-config.yaml` - 설정 예제

---

## 성공 기준

1. ✅ 라우터가 path params와 wildcards를 올바르게 매칭
2. ✅ Upstream proxy가 요청/응답을 정확히 전달
3. ✅ FallbackHandler가 provider 가용성에 따라 올바르게 라우팅
4. ✅ `/api/provider/:provider/v1/*` 라우트가 동작
5. ✅ 모든 테스트 통과 (50+ tests)
6. ✅ TypeScript 타입 체크 통과

---

## 후속 작업 (다음 계획)

이 계획 완료 후 추가할 기능:

1. **Model Mapping 시스템** - 모델 별칭 및 fallback chain
2. **Gemini Bridge** - `/publishers/google/models/...` 경로 지원
3. **Response Rewriter** - 응답에서 모델명 재작성
4. **관리 라우트** - `/api/user`, `/api/auth`, `/threads` 등
5. **Hot Reload** - 설정 변경 시 동적 재로딩

---

## Notes

### Implementation Notes
*(구현 중 기록)*

