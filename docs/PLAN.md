# llmux - LLM Provider Proxy Library

**Version:** 2.0  
**Created:** 2025-12-24  
**Updated:** 2025-12-24  
**Status:** ✅ Complete (Phase 7)  
**Language:** TypeScript + Bun  
**Architecture:** Hub-and-Spoke + Strategy Pattern

---

## Overview

다중 AI 공급사(OpenAI, Anthropic, Gemini, Antigravity 등) 간의 요청/응답을 양방향 변환하는 TypeScript SDK 라이브러리.

```typescript
import { transform, providers } from 'llmux'

// Gemini 형식 요청 → Anthropic API 호출 → Gemini 형식 응답
const response = await llmux.proxy(geminiRequest, {
  from: 'gemini',
  to: 'anthropic',
})
```

### 핵심 목표

1. **SDK 라이브러리**: npm/jsr 패키지로 배포, 다른 프로젝트에서 import
2. **양방향 변환**: A → B (요청) → B → A (응답) 12개 조합 지원
3. **스트리밍 지원**: SSE 기반 실시간 스트리밍 변환
4. **Thinking 지원**: Claude thinking 블록, Gemini thoughtSignature 처리
5. **인증 통합**: OAuth, API Key, Device Flow 등 다양한 인증 방식

### 지원 공급사

| 공급사 | 요청 형식 | 응답 형식 | 특수 기능 |
|--------|----------|----------|----------|
| **OpenAI** | `messages[]` | `choices[]` | function_call, reasoning_effort |
| **Anthropic** | `messages[]` + `system` | `content[]` | thinking blocks, signature |
| **Gemini** | `contents[].parts[]` | `candidates[]` | thoughtSignature, thinkingConfig |
| **Antigravity** | Gemini-style wrapped | Gemini-style wrapped | unified gateway, VALIDATED mode |
| **Copilot** (추후) | OpenAI 호환 | OpenAI 호환 | GitHub Device Flow |

### 변환 매트릭스

| From ↓ / To → | OpenAI | Anthropic | Gemini | Antigravity |
|---------------|:------:|:---------:|:------:|:-----------:|
| **OpenAI** | - | ✅ | ✅ | ✅ |
| **Anthropic** | ✅ | - | ✅ | ✅ |
| **Gemini** | ✅ | ✅ | - | ✅ |
| **Antigravity** | ✅ | ✅ | ✅ | - |

---

## Phase Summary

| Phase | Description | Status | Time |
|-------|-------------|--------|------|
| 1 | 프로젝트 초기화 | ✅ Complete | ~1h |
| 2 | Core Types | ✅ Complete | ~1.5h |
| 3 | Schema Transformation | ✅ Complete | ~1.5h |
| 4 | OpenAI Provider | ✅ Complete | ~2h |
| 5 | Anthropic Provider | ✅ Complete | ~2h |
| 6 | Gemini Provider | ✅ Complete | ~2h |
| 7 | Antigravity Provider | ✅ Complete | ~2h |
| 8 | Signature Cache | ⏳ Pending | 2h |
| 9 | Transform API | ⏳ Pending | 2h |
| 10 | 공개 API & 빌드 | ⏳ Pending | 2h |
| 11 | 테스트 & 문서화 | ⏳ Pending | 3h |
| 12 | Auth 모듈 (선택) | ⏳ Pending | 4h |
| 13 | Server 모듈 (선택) | ⏳ Pending | 3h |

---

## Architecture

### Hub-and-Spoke 패턴

```
┌─────────────────────────────────────────────────────────────┐
│  Source Request (Gemini 형식)                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  GeminiProvider.parse() → UnifiedRequest (허브)             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AnthropicProvider.transform() → Anthropic Request          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AnthropicProvider.parseResponse() → UnifiedResponse        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  GeminiProvider.transformResponse() → Gemini Response       │
└─────────────────────────────────────────────────────────────┘
```

### 프로젝트 구조

```
llmux/
├── packages/
│   ├── core/                        # @llmux/core - SDK 라이브러리
│   │   ├── src/
│   │   │   ├── index.ts             # 공개 API
│   │   │   ├── types/
│   │   │   │   ├── unified.ts       # UnifiedRequest, UnifiedResponse
│   │   │   │   └── index.ts
│   │   │   ├── providers/
│   │   │   │   ├── base.ts          # Provider 인터페이스
│   │   │   │   ├── openai/
│   │   │   │   ├── anthropic/
│   │   │   │   ├── gemini/
│   │   │   │   ├── antigravity/
│   │   │   │   ├── registry.ts
│   │   │   │   └── index.ts
│   │   │   ├── transform/
│   │   │   ├── schema/
│   │   │   ├── cache/
│   │   │   └── utils/
│   │   ├── test/
│   │   └── package.json
│   ├── auth/                        # @llmux/auth (선택)
│   └── server/                      # @llmux/server (선택)
├── docs/
│   ├── PLAN.md                      # 이 파일
│   └── reference/                   # API 스키마 참조 문서
├── biome.json
├── tsconfig.json
└── package.json
```

---

## Commands

```bash
# Development
bun install          # Install dependencies
bun run build        # Build all packages
bun run typecheck    # Type check
bun run lint         # Lint (Biome)
bun run format       # Format (Biome)
bun run check        # Lint + Format check
bun run test         # Run tests

# Per-package
bun run --filter @llmux/core build
```

---

## Phase 1: 프로젝트 초기화 ✅ Complete

**예상 시간:** 1시간  
**실제 시간:** ~1시간  
**리스크:** 🟢 Low

### Tasks

- [x] 1.1 모노레포 초기화
- [x] 1.2 워크스페이스 설정
- [x] 1.3 TypeScript 설정
- [x] 1.4 @llmux/core 패키지 초기화
- [x] 1.5 Tooling 마이그레이션 (ESLint+Prettier → Biome+Bunup)
  - @biomejs/biome v2.3.10 (lint + format)
  - bunup v0.16.11 (build + DTS generation)
  - Husky + lint-staged pre-commit hook

### Quality Gate ✅

```bash
bun run build    # ✅ Passed
bun run typecheck # ✅ Passed
```

### Implementation Notes (2025-12-24)
- Monorepo structure: packages/core, auth, server
- Tooling: Biome v2.3.10, Bunup v0.16.11, TypeScript 5.9.3
- Git hooks configured with Husky

---

## Phase 2: Core Types ✅ Complete

**예상 시간:** 2시간  
**실제 시간:** ~1.5시간  
**리스크:** 🟢 Low

### Tasks

- [x] 2.1 `types/unified.ts` - UnifiedRequest, UnifiedResponse
- [x] 2.2 UnifiedMessage, ContentPart (unified.ts에 통합)
- [x] 2.3 UnifiedTool, ToolCall, ToolResult (unified.ts에 통합)
- [x] 2.4 GenerationConfig, ThinkingConfig (unified.ts에 통합)
- [x] 2.5 `providers/base.ts` - Provider 인터페이스

### Quality Gate ✅

```bash
bun run typecheck    # ✅ Passed
bun test packages/core/test/types/  # ✅ 43 tests passed
```

### Implementation Notes (2025-12-24)
- 타입을 unified.ts 단일 파일에 통합 (message, tool, config 분리 불필요)
- BaseProvider abstract class 추가
- 43개 단위 테스트 작성 (unified.test.ts, base.test.ts)

---

## Phase 3: Schema Transformation ✅ Complete

**예상 시간:** 2시간  
**실제 시간:** ~1.5시간  
**리스크:** 🟡 Medium

### Tasks

- [x] 3.1 `schema/sanitize.ts`
  - Allowlist 기반 스키마 정제
  - 지원 필드: `type`, `properties`, `required`, `description`, `enum`, `items`, `additionalProperties`
  - 제거 필드: `$schema`, `$id`, `default`, `examples`, `title`

- [x] 3.2 `schema/transform.ts`
  - `const` → `enum: [value]` 변환
  - `$ref` / `$defs` 인라인화
  - `anyOf` → `any_of` (Gemini용)
  - Empty schema placeholder 추가

- [x] 3.3 Tool name sanitization
  - 특수문자 제거/대체
  - 64자 제한
  - 첫 글자 규칙

### Quality Gate ✅

```bash
bun test packages/core/test/schema/  # 57 tests passed
```

### Implementation Notes (2025-12-24)
- TDD 접근: 테스트 먼저 작성, 실패 확인 후 구현
- `sanitize.ts`: disallowed 필드 제거, 중첩 스키마 재귀 처리
- `transform.ts`: `constToEnum`, `inlineRefs`, `anyOfToSnakeCase`, `addEmptySchemaPlaceholder` 개별 함수 + 통합 `transformSchema`
- `tool-name.ts`: Gemini 호환 이름 생성 (64자, 특수문자 처리, 첫 글자 규칙)
- 57개 테스트 통과

---

## Phase 4: OpenAI Provider ⏳ Pending

**예상 시간:** 3시간  
**리스크:** 🟡 Medium

### Tasks

- [ ] 4.1 `providers/openai/types.ts` - OpenAI 전용 타입
- [ ] 4.2 `providers/openai/request.ts`
  - `parse()`: OpenAI → Unified
  - `transform()`: Unified → OpenAI
- [ ] 4.3 `providers/openai/response.ts`
  - `parseResponse()`: OpenAI Response → Unified
  - `transformResponse()`: Unified → OpenAI Response
- [ ] 4.4 `providers/openai/streaming.ts`
  - SSE delta 처리
  - tool_calls 스트리밍

### Quality Gate

```bash
bun test packages/core/test/providers/openai/
```

---

## Phase 5: Anthropic Provider ⏳ Pending

**예상 시간:** 4시간  
**리스크:** 🟠 High (Thinking 복잡도)

### Tasks

- [ ] 5.1 `providers/anthropic/types.ts`
- [ ] 5.2 `providers/anthropic/thinking.ts`
  - Thinking 블록 감지 (`type: "thinking"`, `thought: true`)
  - Signature 검증 (≥50자)
  - `cache_control` 제거
  - Trailing thinking 블록 처리
- [ ] 5.3 `providers/anthropic/request.ts`
  - `system` 필드 분리
  - `anthropic-version`, `anthropic-beta` 헤더
  - `thinking` config (snake_case)
- [ ] 5.4 `providers/anthropic/response.ts`
  - `content[]` → `parts[]`
  - `stop_reason` 매핑
- [ ] 5.5 `providers/anthropic/streaming.ts`
  - `message_start`, `content_block_*`, `message_delta` 이벤트

### Quality Gate

```bash
bun test packages/core/test/providers/anthropic/
```

---

## Phase 6: Gemini Provider ⏳ Pending

**예상 시간:** 3시간  
**리스크:** 🟡 Medium

### Tasks

- [ ] 6.1 `providers/gemini/types.ts`
- [ ] 6.2 `providers/gemini/request.ts`
  - `contents[]` with `parts[]`
  - `role: "model"` (not "assistant")
  - `systemInstruction: { parts: [] }` (객체 필수)
  - `thinkingConfig` (camelCase)
- [ ] 6.3 `providers/gemini/response.ts`
  - `candidates[]` → Unified
  - `thoughtSignature` 처리
  - `finishReason` 매핑
- [ ] 6.4 `providers/gemini/streaming.ts`

### Quality Gate

```bash
bun test packages/core/test/providers/gemini/
```

---

## Phase 7: Antigravity Provider ⏳ Pending

**예상 시간:** 3시간  
**리스크:** 🟠 High (Wrapper 복잡도)

### Tasks

- [ ] 7.1 `providers/antigravity/types.ts`
- [ ] 7.2 `providers/antigravity/request.ts`
  - `{ project, model, request, userAgent, requestId }` wrapper
  - Model alias 처리 (`gemini-claude-*` → `claude-*`)
  - `toolConfig.functionCallingConfig.mode = "VALIDATED"`
  - Claude vs Gemini 분기
- [ ] 7.3 `providers/antigravity/response.ts`
  - Wrapper unwrap (`response.response`)
  - Error rewriting (preview access, rate limit)
- [ ] 7.4 `providers/antigravity/streaming.ts`
  - SSE transform stream

### Quality Gate

```bash
bun test packages/core/test/providers/antigravity/
```

---

## Phase 8: Signature Cache ⏳ Pending

**예상 시간:** 2시간  
**리스크:** 🟡 Medium

### Tasks

- [ ] 8.1 `cache/signature.ts`
  ```typescript
  interface SignatureCache {
    store(key: CacheKey, signature: string): void
    restore(key: CacheKey): string | undefined
    validate(signature: string, family: ModelFamily): boolean
  }
  
  interface CacheKey {
    sessionId: string
    model: string
    textHash: string
  }
  ```

- [ ] 8.2 캐시 정책
  - TTL: 1시간
  - Max entries: 세션당 100개
  - Model family 격리 (claude, gemini 별도)

- [ ] 8.3 Provider 통합
  - Anthropic/Gemini response에서 signature 추출 및 캐싱
  - Request에서 signature 복원

### Quality Gate

```bash
bun test packages/core/test/cache/
```

---

## Phase 9: Transform API ⏳ Pending

**예상 시간:** 2시간  
**리스크:** 🟢 Low

### Tasks

- [ ] 9.1 `transform/request.ts`
  ```typescript
  export function transform(
    request: unknown,
    options: { from: ProviderName; to: ProviderName }
  ): unknown
  ```

- [ ] 9.2 `transform/response.ts`
  ```typescript
  export function transformResponse(
    response: unknown,
    options: { from: ProviderName; to: ProviderName }
  ): unknown
  ```

- [ ] 9.3 `transform/stream.ts`
  ```typescript
  export function transformStream(
    stream: ReadableStream<Uint8Array>,
    options: { from: ProviderName; to: ProviderName }
  ): ReadableStream<Uint8Array>
  ```

- [ ] 9.4 `providers/registry.ts`
  ```typescript
  export function getProvider(name: ProviderName): Provider
  export function registerProvider(name: string, provider: Provider): void
  ```

### Quality Gate

```bash
bun test packages/core/test/transform/
```

---

## Phase 10: 공개 API & 빌드 ⏳ Pending

**예상 시간:** 2시간  
**리스크:** 🟢 Low

### Tasks

- [ ] 10.1 `index.ts` - 공개 API export
  ```typescript
  // 변환 함수
  export { transform, transformResponse, transformStream } from './transform'
  
  // Provider
  export { getProvider, registerProvider, providers } from './providers'
  
  // 타입
  export type { 
    UnifiedRequest, 
    UnifiedResponse,
    Provider,
    ProviderName 
  } from './types'
  ```

- [ ] 10.2 package.json exports 설정
- [ ] 10.3 빌드 스크립트

### Quality Gate

```bash
bun run build
bun run typecheck
npm pack --dry-run
```

---

## Phase 11: 테스트 & 문서화 ⏳ Pending

**예상 시간:** 3시간  
**리스크:** 🟢 Low

### Tasks

- [ ] 11.1 단위 테스트
  - 각 Provider별 parse/transform
  - Schema transformation
  - Signature cache

- [ ] 11.2 통합 테스트
  - 12개 변환 조합 테스트
  - 왕복 변환 검증 (A → B → A)

- [ ] 11.3 스트리밍 테스트
  - SSE 청크 변환
  - Partial JSON 처리

- [ ] 11.4 문서화
  - README.md
  - API 문서 (TypeDoc)
  - 사용 예시

### Quality Gate

```bash
bun test --coverage
```

---

## Phase 12: Auth 모듈 (선택) ⏳ Pending

**예상 시간:** 4시간  
**리스크:** 🟡 Medium

### Tasks

- [ ] 12.1 `@llmux/auth` 패키지 초기화
- [ ] 12.2 OAuth 2.0 구현
- [ ] 12.3 API Key 관리
- [ ] 12.4 Provider별 인증
  - Anthropic OAuth
  - Google OAuth
  - GitHub Device Flow (Copilot)

---

## Phase 13: Server 모듈 (선택) ⏳ Pending

**예상 시간:** 3시간  
**리스크:** 🟢 Low

### Tasks

- [ ] 13.1 `@llmux/server` 패키지 초기화
- [ ] 13.2 Bun.serve() HTTP 서버
- [ ] 13.3 프록시 엔드포인트
  ```
  POST /v1/proxy
  X-From-Provider: gemini
  X-To-Provider: anthropic
  ```
- [ ] 13.4 스트리밍 프록시

---

## 배포 계획

### npm 배포

```bash
# 빌드
bun run build

# 테스트
bun test

# 배포
npm publish --access public
```

### 패키지 구조

| 패키지 | 용도 | 의존성 |
|--------|------|--------|
| `@llmux/core` | SDK 라이브러리 | 없음 |
| `@llmux/auth` | 인증 모듈 | `@llmux/core` |
| `@llmux/server` | 프록시 서버 | `@llmux/core`, `@llmux/auth` |

---

## 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Thinking signature 처리 복잡 | 🟠 High | Phase 8에서 집중 처리, 기존 코드 참조 |
| Antigravity wrapper 변경 | 🟡 Medium | 스키마 문서 지속 업데이트 |
| 스트리밍 partial JSON | 🟡 Medium | 버퍼링 + 에러 복구 |
| Provider API 변경 | 🟡 Medium | 버전별 분기 지원 |

---

## 성공 기준

1. ✅ 12개 변환 조합 모두 작동
2. ✅ SSE 스트리밍 실시간 변환
3. ✅ Thinking signature 캐싱/복원
4. ✅ npm 패키지 배포 가능
5. ✅ 테스트 커버리지 80% 이상
6. ✅ TypeScript 타입 완전 지원

---

## 참조 문서

API 스키마 및 설계 문서는 `docs/reference/` 폴더 참조:

| Document | Description |
|----------|-------------|
| [openai-chat-completions-schema.md](reference/openai-chat-completions-schema.md) | OpenAI Chat Completions API 스키마 |
| [anthropic-api-schema.md](reference/anthropic-api-schema.md) | Anthropic Messages API 스키마 |
| [gemini-api-schema.md](reference/gemini-api-schema.md) | Gemini GenerateContent API 스키마 |
| [antigravity-api-schema.md](reference/antigravity-api-schema.md) | Antigravity API 스키마 |
| [provider-schema-comparison.md](reference/provider-schema-comparison.md) | Provider 간 스키마 비교 |

---

## Implementation Notes

*(구현 중 기록)*
