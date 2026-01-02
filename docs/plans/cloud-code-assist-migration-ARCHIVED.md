# Cloud Code Assist API Migration Plan

## Overview
- **Feature**: Antigravity Provider를 Cloud Code Assist API 형식으로 마이그레이션
- **Status**: ⏳ Pending
- **Priority**: High
- **Estimated Time**: 4-6시간
- **Last Updated**: 2025-01-26

## Problem Statement

현재 llmux의 `AntigravityProvider` (auth 패키지)가 잘못된 엔드포인트를 사용하고 있음:
- **현재**: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
- **필요**: `https://cloudcode-pa.googleapis.com/v1internal:generateContent`

### 현재 상태 분석

| 컴포넌트 | 현재 상태 | 변경 필요 |
|---------|----------|---------|
| core/providers/antigravity/request.ts | ✅ 래핑 구현 완료 | 🟢 없음 |
| core/providers/antigravity/response.ts | ✅ 언래핑 구현 완료 | 🟢 없음 |
| core/providers/antigravity/streaming.ts | ✅ SSE 파싱 완료 | 🟢 없음 |
| auth/providers/antigravity.ts | ❌ 잘못된 엔드포인트 | 🔴 필수 |
| auth/providers/base.ts | ⚠️ 스트리밍 미지원 | 🟡 선택 |

---

## Phase 1: AuthProvider 엔드포인트 수정 (필수)

**Goal**: `getEndpoint()`가 Cloud Code Assist 엔드포인트를 반환하도록 수정

**Risk**: 🟡 Medium - 기존 API 호출 경로 변경

### Tasks

- [ ] **1.1** AuthProvider 인터페이스에 스트리밍 지원 추가
  - `auth/providers/base.ts` 수정
  - `getEndpoint(model: string, options?: { streaming?: boolean }): string`

- [ ] **1.2** `antigravity.ts`의 `getEndpoint()` 구현 수정
  - `generativelanguage.googleapis.com` → `cloudcode-pa.googleapis.com` 변경
  - `/v1beta/models/${model}:generateContent` → `/v1internal:generateContent` 변경
  - 스트리밍: `/v1internal:streamGenerateContent?alt=sse`

- [ ] **1.3** `antigravity-constants.ts`에 경로 상수 추가
  - `ANTIGRAVITY_API_PATH_GENERATE = '/v1internal:generateContent'`
  - `ANTIGRAVITY_API_PATH_STREAM = '/v1internal:streamGenerateContent?alt=sse'`

### Code Changes

**auth/providers/base.ts:**
```typescript
export interface EndpointOptions {
  streaming?: boolean
}

export interface AuthProvider {
  // ... existing fields ...
  getEndpoint(model: string, options?: EndpointOptions): string
}
```

**auth/providers/antigravity.ts:**
```typescript
import {
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
} from './antigravity-constants'

getEndpoint(model: string, options?: { streaming?: boolean }): string {
  const path = options?.streaming 
    ? ANTIGRAVITY_API_PATH_STREAM 
    : ANTIGRAVITY_API_PATH_GENERATE
  return `${ANTIGRAVITY_ENDPOINT_PROD}${path}`
}
```

### Quality Gate
- [ ] TypeScript 컴파일 성공
- [ ] 기존 테스트 통과 (`pnpm test`)
- [ ] 엔드포인트 단위 테스트 추가

---

## Phase 2: HTTP 클라이언트 헤더 통합

**Goal**: Cloud Code Assist 전용 헤더가 모든 요청에 포함되도록 보장

**Risk**: 🟢 Low - 추가적인 헤더 주입

### Tasks

- [ ] **2.1** `getHeaders()` 메서드에 `ANTIGRAVITY_HEADERS` 병합
  - `User-Agent`, `X-Goog-Api-Client`, `Client-Metadata` 추가
  - 스트리밍 시 `Accept: text/event-stream` 추가

- [ ] **2.2** 헤더 통합 테스트 작성

### Code Changes

**auth/providers/antigravity.ts:**
```typescript
async getHeaders(credential: Credential): Promise<Record<string, string>> {
  const baseHeaders = {
    ...ANTIGRAVITY_HEADERS,
    'Content-Type': 'application/json',
  }

  if (isOAuthCredential(credential)) {
    return {
      ...baseHeaders,
      Authorization: `Bearer ${credential.accessToken}`,
    }
  }

  return baseHeaders
}
```

### Quality Gate
- [ ] 헤더 테스트 통과
- [ ] 기존 인증 테스트 통과

---

## Phase 3: 엔드포인트 Fallback 구현 (선택)

**Goal**: 엔드포인트 실패 시 자동 fallback

**Risk**: 🟡 Medium - HTTP 클라이언트 수정 필요

### Tasks

- [ ] **3.1** Fallback 로직 설계
  - `ANTIGRAVITY_ENDPOINT_FALLBACKS` 순서: daily → autopush → prod
  - 재시도 조건: 403, 404, 500+

- [ ] **3.2** HTTP 클라이언트에 fallback 로직 구현
  - 현재 사용 중인 HTTP 클라이언트 파악
  - retry 로직 추가

- [ ] **3.3** 429 Rate Limit 처리
  - `Retry-After` 헤더 파싱
  - 계정 로테이션 (`rotate()`) 연동

### Quality Gate
- [ ] Fallback 단위 테스트
- [ ] 통합 테스트 (mock 서버)

---

## Phase 4: 통합 테스트 및 검증

**Goal**: 전체 파이프라인 동작 확인

**Risk**: 🟢 Low

### Tasks

- [ ] **4.1** Mock 서버로 Cloud Code Assist API 시뮬레이션
- [ ] **4.2** 실제 OAuth 토큰으로 테스트 (선택)
- [ ] **4.3** 스트리밍/비스트리밍 모두 테스트

### Quality Gate
- [ ] 모든 통합 테스트 통과
- [ ] 빌드 성공

---

## Files to Modify

| File | Change Type | Risk |
|------|-------------|------|
| `llmux/packages/auth/src/providers/base.ts` | Interface 수정 | 🟡 Medium |
| `llmux/packages/auth/src/providers/antigravity.ts` | 엔드포인트/헤더 수정 | 🔴 High |
| `llmux/packages/auth/src/providers/antigravity-constants.ts` | 상수 추가 | 🟢 Low |
| `llmux/packages/auth/test/providers/antigravity.test.ts` | 테스트 업데이트 | 🟢 Low |

---

## Dependencies

- 없음 (외부 라이브러리 추가 불필요)

---

## Rollback Plan

1. 기존 `generativelanguage.googleapis.com` 엔드포인트로 복원
2. `getEndpoint()` 메서드 원복

---

## Notes

### 2025-01-26 분석 결과
- **core 패키지**: 이미 Cloud Code Assist 래핑 형식 구현 완료
  - `request.ts`: `{ project, model, userAgent, requestId, request: {...} }` 구조 생성
  - `response.ts`: `{ response: {...} }` 구조에서 언래핑
  - `streaming.ts`: SSE `data: {"response": {...}}` 파싱
- **auth 패키지**: 엔드포인트만 수정하면 됨
