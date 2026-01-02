# llmux - LLM Provider Proxy Library

**Version:** 2.1  
**Created:** 2025-12-24  
**Updated:** 2025-12-25  
**Status:** ✅ Phase 1-14 Complete | ⏳ Phase 15-16 Pending  
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
6. **AI SDK 호환**: `@ai-sdk/*` (Vercel AI SDK) 스키마와 양방향 호환
7. **LiteLLM 호환**: LiteLLM (Python) 요청/응답 형식 지원

### 지원 공급사

| 공급사 | 요청 형식 | 응답 형식 | 특수 기능 |
|--------|----------|----------|----------|
| **OpenAI** | `messages[]` | `choices[]` | function_call, reasoning_effort |
| **Anthropic** | `messages[]` + `system` | `content[]` | thinking blocks, signature |
| **Gemini** | `contents[].parts[]` | `candidates[]` | thoughtSignature, thinkingConfig |
| **Antigravity** | Gemini-style wrapped | Gemini-style wrapped | unified gateway, VALIDATED mode |
| **Copilot** (추후) | OpenAI 호환 | OpenAI 호환 | GitHub Device Flow |
| **AI SDK** | `LanguageModelV2Prompt` | `LanguageModelV2Content` | @ai-sdk/* 호환 |
| **LiteLLM** | OpenAI 호환 확장 | OpenAI 호환 확장 | Python SDK 호환 |

### 변환 매트릭스

| From ↓ / To → | OpenAI | Anthropic | Gemini | Antigravity |
|---------------|:------:|:---------:|:------:|:-----------:|
| **OpenAI** | - | ✅ | ✅ | ✅ |
| **Anthropic** | ✅ | - | ✅ | ✅ |
| **Gemini** | ✅ | ✅ | - | ✅ |
| **Antigravity** | ✅ | ✅ | ✅ | - |

---

## Phase Summary

| Phase | Description | Status | Progress | Time |
|-------|-------------|--------|----------|------|
| 1 | 프로젝트 초기화 | ✅ Complete | 100% | ~1h |
| 2 | Core Types | ✅ Complete | 100% | ~1.5h |
| 3 | Schema Transformation | ✅ Complete | 100% | ~1.5h |
| 4 | OpenAI Provider | ✅ Complete | 100% | ~2h |
| 5 | Anthropic Provider | ✅ Complete | 100% | ~2h |
| 6 | Gemini Provider | ✅ Complete | 100% | ~2h |
| 7 | Antigravity Provider | ✅ Complete | 100% | ~2h |
| 8 | Signature Cache | ✅ Complete | 100% | ~1h |
| 9 | Transform API | ✅ Complete | 100% | ~1h |
| 10 | 공개 API & 빌드 | ✅ Complete | 100% | ~0.5h |
| 11 | 테스트 & 문서화 | ✅ Complete | 100% | ~3h |
| 12 | Auth 모듈 | ✅ Complete | 100% | ~1.5h |
| 13 | Server 모듈 | ✅ Complete | 100% | ~1.5h |
| 14 | CLI 통합 패키지 | ✅ Complete | 100% | ~2h |
| 15 | AI SDK 호환 레이어 | ✅ Complete | 100% | ~3h |
| 16 | LiteLLM 호환 레이어 | ⏳ Pending | 0% | 3h |
| 17 | Unified Streaming Model 개선 | ✅ Complete | 100% | ~6h |

---

## 진행 상황 요약 (2025-12-26)

### 완료된 작업
- ✅ Phase 1-11: Core 라이브러리 100% 완료 (~90-95% 테스트 커버리지)
- ✅ Phase 12: Auth 모듈 완료 (CredentialStorage, TokenRefresh, Provider Registry, 60+ tests)
- ✅ Phase 13: Server 모듈 완료 (Bun.serve, Router, Routing, ConfigLoader, transformStreamChunk, 60+ tests)
- ✅ Phase 14: CLI 통합 완료 (auth, serve, proxy, stream, config 명령어)
- ✅ Phase 15: AI SDK 호환 레이어 완료 (LanguageModelV3 양방향 변환, 86 tests)

### 현재 진행 중
- ⏳ Phase 16: LiteLLM 호환 레이어 (선택적)

### 통계
- **소스 파일**: 90+개 TypeScript 파일
- **테스트 파일**: 60+개 테스트 파일  
- **테스트 통과**: 1,001개 단위/통합 테스트 (core 1001 테스트 + auth/server/cli 추가)
- **빌드 크기**: @llmux/core 105KB (AI SDK 포함), @llmux/auth 8.5KB, @llmux/server 13KB, @llmux/cli ~15KB
- **타입 체크**: ✅ 통과

### 미완료 작업
- ⏳ **Phase 16**: LiteLLM 호환 레이어 (Python SDK 호환)

---

## Phase 12-14 완료 상세 (2025-12-25)

### Phase 12: Auth 모듈 ✅ Complete

**구현 완료:**
- `TokenRefresh.ensureFresh` → proxy handler 완전 통합
- Multi-credential 저장/조회/업데이트 구현
- OAuth refresh 흐름 지원 (provider.refresh 호출)
- getCredential → ensureFresh 체이닝 패턴

**테스트 완료:**
- storage.test.ts: multi-credential 테스트 (15+ tests)
- refresh.test.ts: OAuth refresh 흐름 테스트 (10+ tests)

### Phase 13: Server 모듈 ✅ Complete

**구현 완료:**
- RoutingConfig 타입 정의 (defaultProvider, modelMapping, fallbackOrder)
- ConfigLoader: ~/.llmux/config.yaml 읽기/쓰기
- Router class: 모델 라우팅, fallback, 429 rotation
- transformStreamChunk: cross-provider 스트리밍 변환
- /providers 엔드포인트

**테스트 완료:**
- config.test.ts: YAML 로드/저장 테스트 (10+ tests)
- routing.test.ts: Router 클래스 테스트 (11 tests)
- streaming-transform.test.ts: 스트림 변환 테스트 (9 tests)
- handlers/providers.test.ts: /providers 엔드포인트 테스트 (3 tests)

### Phase 14: CLI 통합 ✅ Complete

**구현 완료:**
- `llmux config list/get/set` 명령어
- ~/.llmux/config.yaml 읽기/쓰기 유틸리티
- serve 명령어에서 config 파일 로드

**테스트 완료:**
- cli.test.ts: auth, config 명령어 테스트 (10+ tests)

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

## Phase 4: OpenAI Provider ✅ Complete

**예상 시간:** 3시간  
**실제 시간:** ~2시간  
**리스크:** 🟡 Medium

### Tasks

- [x] 4.1 `providers/openai/types.ts` - OpenAI 전용 타입
- [x] 4.2 `providers/openai/request.ts`
  - `parse()`: OpenAI → Unified
  - `transform()`: Unified → OpenAI
- [x] 4.3 `providers/openai/response.ts`
  - `parseResponse()`: OpenAI Response → Unified
  - `transformResponse()`: Unified → OpenAI Response
- [x] 4.4 `providers/openai/streaming.ts`
  - SSE delta 처리
  - tool_calls 스트리밍

### Quality Gate ✅

```bash
bun test packages/core/test/providers/openai/  # 161 tests passed
```

### Implementation Notes (2025-12-24)
- OpenAIProvider class 완료, BaseProvider 상속
- OpenAIRequest/Response 타입 정의
- reasoning_effort 지원 (o1/o3 모델)
- function_call/tool_calls 호환
- 스트리밍 지원 (delta 처리)

---

## Phase 5: Anthropic Provider ✅ Complete

**예상 시간:** 4시간  
**실제 시간:** ~2시간  
**리스크:** 🟠 High (Thinking 복잡도)

### Tasks

- [x] 5.1 `providers/anthropic/types.ts`
- [x] 5.2 `providers/anthropic/thinking.ts`
  - Thinking 블록 감지 (`type: "thinking"`, `thought: true`)
  - Signature 검증 (≥50자)
  - `cache_control` 제거
  - Trailing thinking 블록 처리
- [x] 5.3 `providers/anthropic/request.ts`
  - `system` 필드 분리
  - `anthropic-version`, `anthropic-beta` 헤더
  - `thinking` config (snake_case)
- [x] 5.4 `providers/anthropic/response.ts`
  - `content[]` → `parts[]`
  - `stop_reason` 매핑
- [x] 5.5 `providers/anthropic/streaming.ts`
  - `message_start`, `content_block_*`, `message_delta` 이벤트

### Quality Gate ✅

```bash
bun test packages/core/test/providers/anthropic/  # 158 tests passed
```

### Implementation Notes (2025-12-24)
- AnthropicProvider class 완료
- thinking 블록 처리 구현
- signature 검증 로직 (최소 50자)
- system 메시지 별도 처리
- 스트리밍 이벤트 파싱

---

## Phase 6: Gemini Provider ✅ Complete

**예상 시간:** 3시간  
**실제 시간:** ~2시간  
**리스크:** 🟡 Medium

### Tasks

- [x] 6.1 `providers/gemini/types.ts`
- [x] 6.2 `providers/gemini/request.ts`
  - `contents[]` with `parts[]`
  - `role: "model"` (not "assistant")
  - `systemInstruction: { parts: [] }` (객체 필수)
  - `thinkingConfig` (camelCase)
- [x] 6.3 `providers/gemini/response.ts`
  - `candidates[]` → Unified
  - `thoughtSignature` 처리
  - `finishReason` 매핑
- [x] 6.4 `providers/gemini/streaming.ts`

### Quality Gate ✅

```bash
bun test packages/core/test/providers/gemini/  # 160 tests passed
```

### Implementation Notes (2025-12-24)
- GeminiProvider class 완료
- contents/parts 구조 처리
- systemInstruction 객체 형식 지원
- thoughtSignature 처리

---

## Phase 7: Antigravity Provider ✅ Complete

**예상 시간:** 3시간  
**실제 시간:** ~2시간  
**리스크:** 🟠 High (Wrapper 복잡도)

### Tasks

- [x] 7.1 `providers/antigravity/types.ts`
- [x] 7.2 `providers/antigravity/request.ts`
  - `{ project, model, request, userAgent, requestId }` wrapper
  - Model alias 처리 (`gemini-claude-*` → `claude-*`)
  - `toolConfig.functionCallingConfig.mode = "VALIDATED"`
  - Claude vs Gemini 분기
- [x] 7.3 `providers/antigravity/response.ts`
  - Wrapper unwrap (`response.response`)
  - Error rewriting (preview access, rate limit)
- [x] 7.4 `providers/antigravity/streaming.ts`
  - SSE transform stream

### Quality Gate ✅

```bash
bun test packages/core/test/providers/antigravity/  # 93 tests passed
```

### Implementation Notes (2025-12-24)
- AntigravityProvider class 완료
- Wrapper 포맷 처리 (request/response)
- Model alias 변환
- VALIDATED mode 설정
- Error rewriting 지원

---

## Phase 8: Signature Cache ✅ Complete

**예상 시간:** 2시간  
**실제 시간:** ~1시간  
**리스크:** 🟡 Medium

### Tasks

- [x] 8.1 `cache/signature.ts`
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

- [x] 8.2 캐시 정책
  - TTL: 1시간 (기본값, 설정 가능)
  - Max entries: 세션당 100개 (기본값, 설정 가능)
  - Model family 격리 (claude, gemini, openai 별도)

- [x] 8.3 스토리지 어댑터
  - `SignatureStorage` 인터페이스
  - `MemoryStorage`: 기본값, 메모리 기반 (서버 재시작 시 초기화)
  - `SQLiteStorage`: bun:sqlite 기반 영구 저장 (서버 운영용)

- [x] 8.4 유틸리티 함수
  - `getModelFamily()`: 모델명에서 family 추출
  - `createTextHash()`: 텍스트 해시 생성

### Quality Gate ✅

```bash
bun test packages/core/test/cache/  # 34 tests passed
```

### Implementation Notes (2025-12-24)
- SignatureCache class 구현 (store, restore, validate, clear)
- TTL 기반 만료 처리
- Max entries 제한 (LRU 방식)
- Model family 격리
- **스토리지 어댑터 패턴** 추가
  - `MemoryStorage`: 개발/테스트용 (기본값)
  - `SQLiteStorage`: 서버 운영용 영구 저장 (bun:sqlite)
- 34개 단위 테스트 통과

---

## Phase 9: Transform API ✅ Complete

**예상 시간:** 2시간  
**실제 시간:** ~1시간  
**리스크:** 🟢 Low

### Tasks

- [x] 9.1 `transform/request.ts`
  ```typescript
  export function transformRequest(
    request: unknown,
    options: { from: ProviderName; to: ProviderName }
  ): unknown
  ```

- [x] 9.2 `transform/response.ts`
  ```typescript
  export function transformResponse(
    response: unknown,
    options: { from: ProviderName; to: ProviderName }
  ): unknown
  ```

- [x] 9.3 `providers/registry.ts`
  ```typescript
  export function getProvider(name: ProviderName): Provider
  export function registerProvider(name: string, provider: Provider): void
  export function hasProvider(name: ProviderName): boolean
  export function getRegisteredProviders(): ProviderName[]
  ```

### Quality Gate ✅

```bash
bun test packages/core/test/transform/  # Tests integrated into provider tests
```

### Implementation Notes (2025-12-24)
- transformRequest, transformResponse 함수 완료
- Provider registry 구현 (Map 기반)
- Hub-and-Spoke 패턴 적용
- transformStream은 Provider.transformStreamChunk로 처리

---

## Phase 10: 공개 API & 빌드 ✅ Complete

**예상 시간:** 2시간  
**실제 시간:** ~0.5시간  
**리스크:** 🟢 Low

### Tasks

- [x] 10.1 `index.ts` - 공개 API export
  ```typescript
  // 변환 함수
  export { transformRequest, transformResponse } from './transform'

  // Provider
  export { getProvider, registerProvider, getRegisteredProviders, hasProvider } from './providers'

  // 타입
  export type {
    UnifiedRequest,
    UnifiedResponse,
    Provider,
    ProviderName
  } from './types'
  ```

- [x] 10.2 package.json exports 설정
- [x] 10.3 빌드 스크립트 (bunup)

### Quality Gate ✅

```bash
bun run build          # ✅ dist/index.js (83KB), dist/index.d.ts (25KB)
bun run typecheck      # ✅ Passed
```

### Implementation Notes (2025-12-24)
- 공개 API export 완료 (src/index.ts)
- bunup v0.16.11 사용으로 빌드 + DTS 생성
- 전체 패키지 크기: 105KB (gzip: 18KB)

---

## Phase 11: 테스트 & 문서화 ✅ Complete

**예상 시간:** 3시간  
**실제 시간:** ~3시간  
**리스크:** 🟢 Low

### Tasks

- [x] 11.1 단위 테스트
  - 각 Provider별 parse/transform
  - Schema transformation
  - [x] Signature cache

- [x] 11.2 통합 테스트
  - 12개 변환 조합 테스트
  - 왕복 변환 검증 (A → B → A)

- [x] 11.3 스트리밍 테스트
  - SSE 청크 변환
  - Partial JSON 처리

- [x] 11.4 문서화
  - README.md (기본 완료)

### Quality Gate ✅

```bash
bun test                 # ✅ 915 pass, 0 fail
bun test --coverage      # ✅ 94.43% Lines, 96.03% Funcs (목표 80% 달성)
```

### Coverage Analysis (2025-12-24)

**현재 커버리지:** 94.43% Lines, 96.03% Funcs

| 파일 | Lines | 상태 |
|------|-------|------|
| `registry.ts` | 100.00% | ✅ 완료 |
| `gemini/response.ts` | 92.86% | ✅ edge cases 추가 |
| `gemini/streaming.ts` | 100.00% | ✅ 에러 핸들링 추가 |
| `gemini/request.ts` | 100.00% | ✅ |
| `schema/transform.ts` | 86.67% | ✅ |

### 완료된 추가 테스트

- [x] **11.5 Cross-provider 통합 테스트**
  - 12개 변환 조합 (`integration.test.ts`)
  - OpenAI ↔ Anthropic ↔ Gemini ↔ Antigravity
  - 요청/응답 왕복 검증 (A → B → A 데이터 무손실)
  - thinking blocks, system prompts, image content, usage info

- [x] **11.6 Gemini response edge cases**
  - 에러 응답 처리 (undefined/null/empty candidates)
  - 빈 candidates 배열
  - 잘못된 finishReason (BLOCKLIST, PROHIBITED_CONTENT, SPII)
  - malformed usageMetadata

- [x] **11.7 Registry 커스텀 provider**
  - `registerProvider()` 함수 테스트
  - 커스텀 provider 등록 및 사용
  - provider override, clear, minimal implementation

- [x] **11.8 Streaming 에러 핸들링**
  - 잘못된 SSE 형식
  - 불완전한 JSON 청크
  - unicode/emoji 처리
  - large chunk handling

### Implementation Notes (2025-12-24)
- 단위/통합 테스트 915개 완료 (31개 테스트 파일)
- 각 Provider별 types, request, response, streaming 테스트
- schema transformation 57개 테스트
- signature cache 34개 테스트 (SQLiteStorage 포함)
- registry.test.ts 16개 테스트 추가
- 커버리지 목표 80% 달성 (실제 94.43%)

---

## Phase 12: Auth 모듈 🟡 In Progress

**예상 시간:** 6시간  
**리스크:** 🟡 Medium

### 개요

`llmux auth login` CLI 명령으로 여러 LLM provider에 인증하고, 저장된 자격증명을 사용해 요청을 프록시하는 시스템.

### 지원 Provider

| Provider | 인증 방식 | 참조 구현 | 특징 |
|----------|----------|----------|------|
| **Opencode Zen** | OAuth 2.0 + API Key | `opencode/src/auth/` | opencode.ai 인증 |
| **GitHub Copilot** | GitHub Device Flow | `opencode-copilot-auth` | Device Code → Token |
| **Antigravity** | Google OAuth + PKCE | `opencode-antigravity-auth` | gemini-cli fallback 지원 |

### 프로젝트 구조

```
packages/auth/
├── src/
│   ├── index.ts                    # 공개 API
│   ├── types.ts                    # 타입 정의
│   ├── storage.ts                  # Credential storage (JSON file)
│   ├── refresh.ts                  # Token refresh manager
│   ├── providers/
│   │   ├── base.ts                 # AuthProvider 인터페이스
│   │   ├── registry.ts             # Provider registry
│   │   ├── opencode-zen/
│   │   │   ├── index.ts            # Opencode Zen auth
│   │   │   └── oauth.ts
│   │   ├── github-copilot/
│   │   │   ├── index.ts            # GitHub Copilot auth
│   │   │   └── device-flow.ts      # Device Flow 구현
│   │   └── antigravity/
│   │       ├── index.ts            # Antigravity auth
│   │       ├── oauth.ts            # Google OAuth + PKCE
│   │       └── gemini-fallback.ts  # gemini-cli fallback
│   └── cli/
│       ├── index.ts                # CLI entry point
│       ├── login.ts                # auth login command
│       ├── logout.ts               # auth logout command
│       └── list.ts                 # auth list command
├── test/
└── package.json
```

### Tasks

- [ ] 12.1 Core Types & Storage
  ```typescript
  // types.ts
  export type AuthType = 'oauth' | 'api' | 'device-flow'
  export type ProviderID = 'opencode-zen' | 'github-copilot' | 'antigravity'
  
  export interface OAuthCredential {
    type: 'oauth'
    accessToken: string
    refreshToken: string
    expiresAt: number
    projectId?: string  // Antigravity용
    email?: string
  }
  
  export interface ApiKeyCredential {
    type: 'api'
    key: string
  }
  
  export type Credential = OAuthCredential | ApiKeyCredential
  
  // storage.ts - ~/.llmux/credentials.json
  export namespace CredentialStorage {
    export async function get(provider: ProviderID): Promise<Credential | undefined>
    export async function set(provider: ProviderID, credential: Credential): Promise<void>
    export async function remove(provider: ProviderID): Promise<void>
    export async function all(): Promise<Record<ProviderID, Credential>>
  }
  ```

- [ ] 12.2 AuthProvider Interface
  ```typescript
  // providers/base.ts
  export interface AuthProvider {
    id: ProviderID
    name: string
    
    // 인증 방법 목록
    methods: AuthMethod[]
    
    // 현재 자격증명 가져오기 (자동 refresh 포함)
    getCredential(): Promise<Credential | undefined>
    
    // API 호출용 헤더 생성
    getHeaders(): Promise<Record<string, string>>
    
    // Endpoint URL
    getEndpoint(model: string): string
  }
  
  export interface AuthMethod {
    type: 'oauth' | 'api' | 'device-flow'
    label: string
    authorize(): Promise<AuthResult>
  }
  ```

- [ ] 12.3 Opencode Zen Provider
  - OAuth 2.0 flow (opencode.ai 인증)
  - API Key 직접 입력 지원
  - 참조: `opencode/packages/opencode/src/cli/cmd/auth.ts#L344-L346`

- [ ] 12.4 GitHub Copilot Provider
  - GitHub Device Flow 구현
  - Device Code 요청 → 사용자 인증 → Access Token 획득
  - 참조: `opencode-copilot-auth` npm 패키지
  ```typescript
  // device-flow.ts
  interface DeviceCodeResponse {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
  
  async function requestDeviceCode(): Promise<DeviceCodeResponse>
  async function pollForToken(deviceCode: string, interval: number): Promise<TokenResponse>
  ```

- [ ] 12.5 Antigravity Provider
  - Google OAuth 2.0 + PKCE
  - loadCodeAssist API로 projectId 획득
  - tier 감지 (free/paid)
  - gemini-cli fallback 지원
  - 참조: `opencode-antigravity-auth/src/antigravity/oauth.ts`
  ```typescript
  // oauth.ts
  export async function authorizeAntigravity(projectId?: string): Promise<AuthorizationResult>
  export async function exchangeAntigravity(code: string, state: string): Promise<TokenResult>
  
  // gemini-fallback.ts
  export async function tryGeminiCLI(): Promise<Credential | undefined>
  ```

- [ ] 12.6 Token Refresh Manager
  ```typescript
  // refresh.ts
  export namespace TokenRefresh {
    // Access token 만료 전 자동 refresh
    export async function ensureFresh(provider: ProviderID): Promise<Credential>
    
    // Provider별 refresh 로직
    export async function refreshOpencode(credential: OAuthCredential): Promise<OAuthCredential>
    export async function refreshGitHubCopilot(credential: OAuthCredential): Promise<OAuthCredential>
    export async function refreshAntigravity(credential: OAuthCredential): Promise<OAuthCredential>
  }
  ```

- [ ] 12.7 CLI Commands
  ```bash
  # 로그인
  llmux auth login                    # Interactive provider 선택
  llmux auth login opencode-zen       # 특정 provider
  llmux auth login antigravity        # Antigravity (gemini fallback 포함)
  
  # 로그아웃
  llmux auth logout                   # Interactive 선택
  llmux auth logout github-copilot    # 특정 provider
  
  # 목록
  llmux auth list                     # 저장된 자격증명 목록
  ```

### 의존성

```json
{
  "dependencies": {
    "@openauthjs/openauth": "^0.4.3",
    "@clack/prompts": "^0.9.1",
    "yargs": "^17.7.2"
  }
}
```

### Quality Gate

```bash
bun test packages/auth/       # 테스트 통과
bun run typecheck             # 타입 체크
llmux auth login              # E2E 테스트
```

---

## Phase 13: Server 모듈 🟡 In Progress

**예상 시간:** 5시간  
**리스크:** 🟡 Medium

### 개요

인증된 provider를 사용해 LLM 요청을 프록시하고, 요청/응답을 caller가 원하는 형식으로 변환하는 HTTP 서버.

### 프로젝트 구조

```
packages/server/
├── src/
│   ├── index.ts                    # 공개 API
│   ├── server.ts                   # Bun.serve() HTTP 서버
│   ├── router.ts                   # 라우팅 로직
│   ├── handlers/
│   │   ├── proxy.ts                # 프록시 핸들러
│   │   ├── health.ts               # Health check
│   │   └── auth-callback.ts        # OAuth callback
│   ├── middleware/
│   │   ├── auth.ts                 # 인증 미들웨어
│   │   ├── transform.ts            # 요청/응답 변환
│   │   └── streaming.ts            # SSE 스트리밍
│   └── config.ts                   # 서버 설정
├── test/
└── package.json
```

### API Endpoints

```
# 프록시 엔드포인트 (형식 자동 감지)
POST /v1/chat/completions           # OpenAI 형식 요청
POST /v1/messages                   # Anthropic 형식 요청
POST /v1/generateContent            # Gemini 형식 요청

# 프록시 엔드포인트 (명시적 변환)
POST /v1/proxy
Headers:
  X-Source-Format: openai|anthropic|gemini|antigravity
  X-Target-Provider: opencode-zen|github-copilot|antigravity
  X-Target-Model: claude-sonnet-4-20250514 (optional)

# OAuth Callback
GET /auth/callback                  # OAuth redirect 처리

# Health
GET /health                         # 서버 상태
GET /providers                      # 인증된 provider 목록
```

### Tasks

- [ ] 13.1 Server Core
  ```typescript
  // server.ts
  export interface ServerConfig {
    port: number                    // 기본값: 8743
    host: string                    // 기본값: localhost
    corsOrigins?: string[]          // CORS 설정
  }
  
  export function createServer(config?: Partial<ServerConfig>): Server
  export function startServer(config?: Partial<ServerConfig>): Promise<void>
  ```

- [ ] 13.2 Proxy Handler
  ```typescript
  // handlers/proxy.ts
  export async function handleProxy(request: Request): Promise<Response> {
    // 1. 요청 형식 감지 (OpenAI/Anthropic/Gemini/Antigravity)
    const sourceFormat = detectFormat(request)
    
    // 2. 대상 provider 결정 (헤더 또는 기본값)
    const targetProvider = getTargetProvider(request)
    
    // 3. 인증 정보 가져오기
    const credential = await AuthProvider.getCredential(targetProvider)
    
    // 4. 요청 변환 (source → target)
    const transformedRequest = transformRequest(body, {
      from: sourceFormat,
      to: targetProvider.format
    })
    
    // 5. provider API 호출
    const response = await callProvider(targetProvider, transformedRequest, credential)
    
    // 6. 응답 변환 (target → source)
    const transformedResponse = transformResponse(response, {
      from: targetProvider.format,
      to: sourceFormat
    })
    
    return transformedResponse
  }
  ```

- [ ] 13.3 Streaming Proxy
  ```typescript
  // middleware/streaming.ts
  export async function handleStreamingProxy(request: Request): Promise<Response> {
    // SSE 스트리밍 변환
    const sourceFormat = detectFormat(request)
    const targetProvider = getTargetProvider(request)
    
    // TransformStream으로 실시간 변환
    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        const transformed = transformStreamChunk(chunk, {
          from: targetProvider.format,
          to: sourceFormat
        })
        controller.enqueue(transformed)
      }
    })
    
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }
  ```

- [ ] 13.4 Provider Routing
  ```typescript
  // router.ts
  export interface RoutingConfig {
    // 기본 provider (인증된 것 중 첫 번째)
    defaultProvider?: ProviderID
    
    // 모델 → provider 매핑
    modelMapping?: Record<string, ProviderID>
    
    // Fallback 순서
    fallbackOrder?: ProviderID[]
  }
  
  export function getTargetProvider(request: Request, config: RoutingConfig): AuthProvider
  ```

- [ ] 13.5 Auth Callback Handler
  ```typescript
  // handlers/auth-callback.ts
  // OAuth callback 처리 (브라우저 → 로컬 서버)
  export async function handleAuthCallback(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    
    // Provider별 token exchange
    const result = await exchangeToken(code, state)
    
    // Credential 저장
    await CredentialStorage.set(result.provider, result.credential)
    
    // 성공 페이지 반환 또는 CLI로 redirect
    return new Response('Login successful! You can close this window.')
  }
  ```

- [ ] 13.6 CLI Integration
  ```bash
  # 서버 시작
  llmux serve                       # 기본 포트 (8743)
  llmux serve --port 3000           # 커스텀 포트
  llmux serve --provider antigravity # 특정 provider만
  
  # 설정 파일 (선택)
  # ~/.llmux/config.yaml
  server:
    port: 8743
    defaultProvider: antigravity
    modelMapping:
      claude-*: antigravity
      gpt-*: github-copilot
  ```

### 요청/응답 흐름

```
┌─────────────────────────────────────────────────────────────┐
│  Client (OpenAI SDK)                                        │
│  POST /v1/chat/completions                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  llmux server                                               │
│  1. Detect format: OpenAI                                   │
│  2. Get target: Antigravity (from config)                   │
│  3. Get credential: OAuth token                             │
│  4. Transform: OpenAI → Gemini (Antigravity format)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Antigravity API                                            │
│  POST /v1/generateContent                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  llmux server                                               │
│  5. Transform response: Gemini → OpenAI                     │
│  6. Return to client                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Client receives OpenAI-format response                     │
└─────────────────────────────────────────────────────────────┘
```

### 의존성

```json
{
  "dependencies": {
    "@llmux/core": "workspace:*",
    "@llmux/auth": "workspace:*"
  }
}
```

### Quality Gate

```bash
bun test packages/server/     # 테스트 통과
bun run typecheck             # 타입 체크
curl localhost:8743/health    # E2E 테스트
```

---

## Phase 14: CLI 통합 패키지 ⏳ Pending

**예상 시간:** 2시간  
**리스크:** 🟢 Low

### 개요

`llmux` CLI 명령어를 제공하는 통합 패키지.

### 프로젝트 구조

```
packages/cli/
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── commands/
│   │   ├── auth.ts                 # auth login/logout/list
│   │   ├── serve.ts                # serve command
│   │   └── config.ts               # config management
│   └── utils/
│       └── ui.ts                   # Terminal UI helpers
├── bin/
│   └── llmux                       # Executable
└── package.json
```

### Commands

```bash
llmux auth login [provider]         # 인증
llmux auth logout [provider]        # 로그아웃
llmux auth list                     # 자격증명 목록

llmux serve [--port] [--provider]   # 프록시 서버 시작
llmux config set <key> <value>      # 설정 변경
llmux config get <key>              # 설정 조회

llmux --version                     # 버전
llmux --help                        # 도움말
```

---

## Phase 15: AI SDK 호환 레이어 ✅ Complete

**예상 시간:** 4시간  
**실제 시간:** ~3시간
**리스크:** 🟡 Medium  
**위치:** `@llmux/core` (core 패키지 확장)

### 개요

Vercel AI SDK (`@ai-sdk/*`)의 `LanguageModelV3` 스키마와 llmux의 `UnifiedRequest/Response` 간 양방향 변환을 지원하여, AI SDK 기반 애플리케이션에서 llmux를 직접 사용할 수 있게 함.

### 스키마 매핑

| @ai-sdk/provider (V3) | @llmux/core | 변환 방향 |
|------------------|-------------|----------|
| `LanguageModelV3Prompt` | `UnifiedMessage[]` | ↔ |
| `LanguageModelV3CallOptions` | `UnifiedRequest` | ↔ |
| `LanguageModelV3Content` | `ContentPart[]` | ↔ |
| `LanguageModelV3TextPart` | `ContentPart.text` | ↔ |
| `LanguageModelV3ReasoningPart` | `ContentPart.thinking` | ↔ |
| `LanguageModelV3ToolCallPart` | `ContentPart.toolCall` | ↔ |
| `LanguageModelV3FilePart` | `ContentPart.image` | ↔ |
| `LanguageModelV3StreamPart` | `StreamChunk` | ↔ |

### 프로젝트 구조

```
packages/core/src/
├── providers/
│   └── ai-sdk/                     # AI SDK 호환 provider
│       ├── index.ts                # AiSdkProvider export
│       ├── types.ts                # AI SDK 타입 re-export + type guards
│       ├── request.ts              # LanguageModelV3CallOptions → UnifiedRequest
│       ├── response.ts             # UnifiedResponse → LanguageModelV3GenerateResult
│       └── streaming.ts            # StreamChunk ↔ LanguageModelV3StreamPart
```

### Tasks

- [x] 15.1 AI SDK 타입 분석 및 매핑 정의
  - `@ai-sdk/provider@3.0.0` 패키지 의존성 추가 (devDependencies)
  - V3 스펙 기반 타입 re-export 및 type guards 구현
  
- [x] 15.2 Request 변환 (`LanguageModelV3CallOptions` → `UnifiedRequest`)
  ```typescript
  // providers/ai-sdk/request.ts
  import type { LanguageModelV2CallOptions } from '@ai-sdk/provider'
  
  export function parse(options: LanguageModelV2CallOptions): UnifiedRequest {
    return {
      messages: parsePrompt(options.prompt),
      config: {
        maxTokens: options.maxOutputTokens,
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        stopSequences: options.stopSequences,
      },
      tools: parseTools(options.tools),
    }
  }
  ```

- [x] 15.3 Response 변환 (`UnifiedResponse` → AI SDK 형식)
  - `parseResponse`: LanguageModelV3GenerateResult → UnifiedResponse
  - `transformResponse`: UnifiedResponse → LanguageModelV3GenerateResult
  - Finish reason 양방향 매핑 (stop ↔ end_turn, length ↔ max_tokens 등)
  - Usage 변환 (V3 nested 형식 ↔ flat UsageInfo)

- [x] 15.4 Streaming 변환
  - `parseStreamPart`: LanguageModelV3StreamPart → StreamChunk
  - `transformStreamPart`: StreamChunk → LanguageModelV3StreamPart
  - text-delta, reasoning-delta, tool-call, finish 등 지원

- [x] 15.5 AiSdkProvider 클래스
  - BaseProvider 상속
  - parse/transform, parseResponse/transformResponse 구현
  - parseStreamChunk/transformStreamChunk 구현
  - 테스트: 86개 테스트 통과

### 사용 예시

```typescript
import { AiSdkProvider, parseAiSdkRequest, transformAiSdkResponse } from '@llmux/core'
import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from '@llmux/core'

// AI SDK 요청 → llmux UnifiedRequest 변환
const unified = parseAiSdkRequest(aiSdkCallOptions)

// llmux UnifiedResponse → AI SDK 응답 변환  
const aiSdkResult = transformAiSdkResponse(unifiedResponse)
```

### Quality Gate ✅

```bash
bun test packages/core/test/providers/ai-sdk/  # 86 tests passed
bun run typecheck                               # No ai-sdk related errors
bun run build                                   # 105KB bundle
```

---

## Phase 16: LiteLLM 호환 레이어 ⏳ Pending

**예상 시간:** 3시간  
**리스크:** 🟢 Low  
**위치:** `@llmux/core` (core 패키지 확장) + `@llmux/server` (엔드포인트)

### 개요

LiteLLM (Python LLM 프록시)의 요청/응답 형식을 지원하여, LiteLLM 클라이언트가 llmux 서버에 직접 연결할 수 있게 함. LiteLLM은 기본적으로 OpenAI 형식을 확장한 형태.

### LiteLLM 특수 필드

| LiteLLM 필드 | 설명 | llmux 매핑 |
|-------------|------|-----------|
| `model` | `provider/model` 형식 (e.g., `anthropic/claude-3`) | provider + model 분리 |
| `api_base` | Custom endpoint | Server routing |
| `custom_llm_provider` | Provider override | ProviderID |
| `metadata` | Request metadata | RequestMetadata |
| `caching` | Response caching | SignatureCache |
| `fallbacks` | Fallback 모델 목록 | Server routing config |
| `num_retries` | 재시도 횟수 | Server middleware |

### 프로젝트 구조

```
packages/core/src/providers/
└── litellm/
    ├── index.ts                    # LiteLLMProvider
    ├── types.ts                    # LiteLLM 확장 필드 타입
    ├── request.ts                  # LiteLLM → UnifiedRequest
    └── response.ts                 # UnifiedResponse → LiteLLM

packages/server/src/handlers/
└── litellm.ts                      # /litellm/* 엔드포인트
```

### Tasks

- [ ] 16.1 LiteLLM 타입 정의
  ```typescript
  // providers/litellm/types.ts
  export interface LiteLLMRequest extends OpenAIRequest {
    // LiteLLM 확장 필드
    custom_llm_provider?: string
    api_base?: string
    metadata?: Record<string, unknown>
    caching?: boolean
    fallbacks?: string[]
    num_retries?: number
  }
  ```

- [ ] 16.2 모델 파싱 (`provider/model` 형식)
  ```typescript
  // providers/litellm/request.ts
  export function parseModelString(model: string): { provider: string; model: string } {
    // "anthropic/claude-3-opus" → { provider: "anthropic", model: "claude-3-opus" }
    // "gpt-4" → { provider: "openai", model: "gpt-4" }
  }
  ```

- [ ] 16.3 Request/Response 변환
  - OpenAI 형식 기반이므로 대부분 OpenAIProvider 재사용
  - LiteLLM 확장 필드만 추가 처리

- [ ] 16.4 Server 엔드포인트
  ```typescript
  // handlers/litellm.ts
  // POST /litellm/chat/completions
  // LiteLLM SDK가 기대하는 형식으로 응답
  ```

### 사용 예시

```python
# Python (LiteLLM 클라이언트)
import litellm

# llmux 서버를 통해 요청
response = litellm.completion(
    model="antigravity/claude-3-opus",
    messages=[{"role": "user", "content": "Hello"}],
    api_base="http://localhost:8743/litellm",
    custom_llm_provider="llmux"
)
```

### Quality Gate

```bash
bun test packages/core/test/providers/litellm/
curl -X POST http://localhost:8743/litellm/chat/completions
```

---

## Phase 17: Unified Streaming Model 개선 ✅ Complete

**예상 시간:** 6시간
**리스크:** 🟠 High (Unified 타입 변경)
**위치:** `@llmux/core`

### 개요
Anthropic의 멀티 블록 스트리밍과 다른 Provider들의 스트리밍 방식 차이를 Unified 레벨에서 해소하기 위해 `StreamChunk` 모델을 확장하고 각 Provider 구현을 개선함.

### 변경 사항
- **Unified**: `StreamChunk`에 `blockIndex`, `blockType`, `type: 'block_stop'` 추가
- **Anthropic**: `content_block_start`, `content_block_stop` 이벤트를 Unified 모델로 매핑
- **OpenAI/Gemini**: `blockIndex` 지원 추가 (기존 0 또는 내부 인덱스 매핑)
- **Response**: `tool_result` 및 `redacted_thinking` 지원 강화

### Quality Gate
```bash
bun test packages/core/test/providers/anthropic/streaming-extended.test.ts
bun test packages/core/test/providers/gemini/streaming-block-index.test.ts
bun run build
bun run typecheck
```

---

## 배포 계획

### 현재 배포 상태 (2025-12-24)
- ✅ 빌드 완료 (bunup)
- ✅ 타입 정의 생성 (DTS)
- ⏳ 통합 테스트 필요
- ⏳ 문서화 필요

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
5. ⏳ 테스트 커버리지 80% 이상 (단위 테스트 804개 완료)
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
