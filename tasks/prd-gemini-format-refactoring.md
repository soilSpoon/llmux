# PRD: Gemini Format & Provider Refactoring (Complete Rewrite)

## Introduction

llmux의 Google Gemini 포맷과 Antigravity/Gemini-CLI 프로바이더를 **완전히 새로 작성**하여 Hub-and-Spoke 아키텍처를 적용하고, 타입 안전성을 강화하며, 현재 발생 중인 tool pairing 400 에러를 해결합니다.

**⚠️ 중요: 기존 코드 호환성 고려 불필요 - 전면 리팩토링**

**현재 문제:**
- `normalizeToolHistory()`가 tool_result를 tool_use 바로 다음 메시지에 배치하지 않아 Claude on Antigravity에서 400 에러 발생
  - 에러 메시지: "unexpected tool_use_id found in tool_result blocks... Each tool_result block must have a corresponding tool_use block in the previous message"
- `Record<string, unknown>`, `any`, `as` 타입 단언, `@ts-expect-error`, `biome-ignore` 등 느슨한 타입 사용
- 프로바이더별 차이점이 조건문으로 분산되어 유지보수 어려움
- Claude vs Gemini 모델별 처리 로직이 혼재

**참조 라이브러리:**
- `opencode-antigravity-auth`: 프로덕션에서 검증된 Antigravity 처리 로직
  - `src/plugin/transform/claude.ts`: Claude-specific transforms
  - `src/plugin/transform/gemini.ts`: Gemini-specific transforms
  - `src/plugin/transform/cross-model-sanitizer.ts`: Signature sanitization
  - `src/plugin/request-helpers.ts`: Tool pairing fixes, schema cleaning
  - `docs/ANTIGRAVITY_API_SPEC.md`: API specification
- Vercel AI SDK: 스트리밍 패턴 참조

---

## Goals

- 현재 발생 중인 tool pairing 400 에러 해결
- Hub-and-Spoke 아키텍처로 코드 구조 개선 (UnifiedRequest/UnifiedResponse가 중앙 허브)
- `any`, `unknown`, `Record<string, unknown>`, `as` 타입 단언, `@ts-expect-error`, `biome-ignore` 완전 제거
- TDD 방식으로 모든 변환 로직 테스트 작성 후 구현
- Antigravity에서 Claude와 Gemini 모델별 차이점 중앙화
- Gemini-CLI와 Antigravity 프로바이더 간 차이점 명확화
- Tool call/result를 명시적 edge로 모델링하여 Claude 엄격 인접성 규칙 컴파일 타임 보장

---

## Architecture: Hub-and-Spoke Model

### 핵심 개념

```
                    ┌─────────────────────┐
                    │   UnifiedRequest    │
                    │   UnifiedResponse   │
                    │      (Hub IR)       │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Antigravity     │ │  Antigravity     │ │   Gemini-CLI     │
│  Claude Adapter  │ │  Gemini Adapter  │ │     Adapter      │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### IR (Intermediate Representation) 설계

```typescript
type ModelFamily = "claude" | "gemini";

// Tool call/result를 명시적 edge로 표현
interface ToolCallEdge {
  id: string;                    // 고유 ID
  name: string;                  // 함수명
  arguments: JsonObject;         // 인자
  issuedAtMessageIndex: number;  // 발행된 메시지 인덱스
}

interface ToolResultEdge {
  toolCallId: string;              // 대응하는 tool call ID
  content: JsonValue;              // 결과
  status: 'success' | 'error';     // 상태
  producedAtMessageIndex: number;  // 생성된 메시지 인덱스
}

// 어댑터에서 Claude 엄격 인접성으로 선형화
```

---

## User Stories

### US-001: Tool Pairing Adjacency 강제 모듈 생성

**Description:** 개발자로서, tool_result가 반드시 tool_use 바로 다음 메시지에 위치하도록 정규화하여 Claude on Antigravity에서 400 에러가 발생하지 않게 합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/util/tool-pairing.ts` 생성
- [x] `enforceToolPairingAdjacency(messages: UnifiedMessage[], strict: boolean): UnifiedMessage[]` 함수 구현
- [x] 모든 `functionCall`에 `id` 필드 보장
- [x] 기존 tool_result를 올바른 위치로 이동/재정렬
- [x] 누락된 tool_result에 대해 합성 결과 생성
- [x] tool 관련 메시지는 merge하지 않음 (경계 유지)
- [ ] 테스트 파일 `tool-pairing.test.ts` 작성 및 통과
- [ ] Typecheck/lint 통과

### US-002: Model Capabilities Resolver 구현

**Description:** 개발자로서, 모델별 quirk를 중앙화된 함수에서 관리하여 조건문이 코드 전체에 분산되지 않게 합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/capabilities.ts` 생성
- [x] `resolveGeminiFamilyCapabilities(ctx: FormatContext)` 함수 구현
- [x] 반환 타입: `{ transport, modelVendor, thinkingWireStyle, thinkingParamStyle, requiresStrictToolPairing, requiresSystemInstructionObject }`
- [x] Claude 모델: `thinkingWireStyle: 'snake'`, `requiresStrictToolPairing: true`
- [x] Gemini 3 모델: `thinkingParamStyle: 'level'`
- [x] Gemini 2.5 모델: `thinkingParamStyle: 'budget'`
- [x] 테스트 파일에서 모든 모델 ID 케이스 커버
- [x] Typecheck/lint 통과

### US-003: Wire Types 분리 (Standard/Antigravity)

**Description:** 개발자로서, 프로바이더별 wire format을 별도 타입으로 정의하여 타입 안전성을 확보합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/standard/wire-types.ts` 생성 (types.ts로 통합됨)
- [x] `packages/core/src/formats/gemini/antigravity/wire-types.ts` 생성 (types.ts로 통합됨)
- [x] `GeminiStandardWireRequest` 타입 정의 (thinkingConfig: camelCase)
- [x] `AntigravityWireRequest` 타입 정의 (project, model, request, userAgent, requestId)
- [x] `AntigravityInnerRequest` discriminated union 타입 (Claude vs Gemini thinking config 분리)
- [x] `MergeExclusive` 대신 discriminated union 사용
- [x] `Record<string, unknown>` 대신 `JsonObject` (type-fest) 사용
- [x] Typecheck/lint 통과

### US-004: Antigravity Claude-specific Transforms

**Description:** 개발자로서, Antigravity에서 Claude 모델 전용 변환 로직을 분리하여 명확하게 관리합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/claude.ts` 생성
- [x] `buildClaudeThinkingConfig()`: snake_case `thinking_config` 생성
- [x] `configureClaudeToolConfig()`: VALIDATED 모드 설정
- [x] `stripThinkingBlocksForHistory()`: 히스토리에서 thinking 블록 제거
- [x] `ensureMaxOutputTokensGreaterThanBudget()`: maxOutputTokens > thinkingBudget 보장
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-005: Antigravity Gemini-specific Transforms

**Description:** 개발자로서, Antigravity에서 Gemini 모델 전용 변환 로직을 분리하여 명확하게 관리합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/gemini.ts` 생성
- [x] `buildGemini3ThinkingConfig()`: thinkingLevel 문자열 사용
- [x] `buildGemini25ThinkingConfig()`: thinkingBudget 숫자 사용
- [x] `handleThoughtSignatures()`: signature 유효성 검사 및 `skip_thought_signature_validator` 처리 (request.ts에 통합됨)
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-006: Schema Sanitizer 개선

**Description:** 개발자로서, Antigravity API가 거부하는 스키마 필드를 완전히 제거하여 400 에러를 방지합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/shared/schema-sanitizer.ts` 생성
- [x] `const` → `enum: [value]` 변환
- [x] 제거할 필드: `$ref`, `$defs`, `definitions`, `$schema`, `$id`, `title`, `default`, `examples`, `additionalProperties`
- [x] Tool name 정규화: `/` → `_`, 첫 글자 `[A-Za-z_]`, 최대 64자
- [x] 빈 스키마에 placeholder 속성 추가
- [x] Golden fixture 테스트 작성
- [x] Typecheck/lint 통과

### US-007: System Instruction 변환

**Description:** 개발자로서, Antigravity API가 요구하는 형식으로 system instruction을 변환합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/system-instruction.ts` 생성 (request.ts에 통합됨)
- [x] 문자열 → `{ parts: [{ text: string }] }` 변환
- [x] Antigravity 전용 시스템 지시문 주입 (Claude + gemini-3-pro-preview 모델만 - thinking-hint.ts 사용)
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-008: Header 프로파일 분리

**Description:** 개발자로서, 프로바이더별 헤더를 명확하게 분리하여 관리합니다.

**Acceptance Criteria:**
- [x] `packages/server/src/providers/headers.ts` 생성 (formats/gemini/antigravity/headers.ts로 대체)
- [x] Antigravity 헤더: `User-Agent`, `X-Goog-Api-Client`, `Client-Metadata` (JSON 형식)
- [x] Gemini-CLI 헤더: 다른 `User-Agent`, `X-Goog-Api-Client`, `Client-Metadata` (key=value 형식)
- [x] `getHeadersForProvider(provider: 'antigravity' | 'gemini-cli')` 함수
- [x] Typecheck/lint 통과

### US-009: Cross-Model Signature Sanitizer

**Description:** 개발자로서, 모델 간 전환 시 thinking signature 충돌을 방지합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/shared/signature-sanitizer.ts` 생성
- [x] Claude → Gemini 전환 시 Claude signature 제거
- [x] Gemini → Claude 전환 시 Gemini thoughtSignature 제거
- [x] `sanitizeCrossModelPayload(payload, targetModel)` 함수
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-010: Streaming State Machine

**Description:** 개발자로서, 스트리밍 이벤트를 타입 안전한 상태 머신으로 처리합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/streaming/state-machine.ts` 생성
- [x] `StreamState` discriminated union 타입 정의 (idle, in_text, in_thinking, in_tool_call, done)
- [x] 상태 전환 함수 구현 (exhaustive check)
- [x] SSE 파싱 → `StreamChunk[]` 변환
- [x] Golden fixture 테스트 (SSE transcript → 예상 StreamChunk[])
- [x] Typecheck/lint 통과

### US-011: Request Builder 통합

**Description:** 개발자로서, 모든 변환 로직을 통합하여 UnifiedRequest → Wire Request를 생성합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/request.ts` 리팩토링
- [x] `buildAntigravityWireRequest(request: UnifiedRequest, ctx: FormatContext): AntigravityWireRequest`
- [x] capabilities resolver 사용하여 모델별 분기
- [x] tool pairing 정규화 적용
- [x] schema sanitizer 적용
- [x] 통합 테스트 작성 및 통과
- [x] Typecheck/lint 통과

### US-012: Type-safe JSON 타입 마이그레이션

**Description:** 개발자로서, `Record<string, unknown>` 대신 `type-fest`의 `JsonObject`를 사용하여 타입 안전성을 확보합니다.

**Acceptance Criteria:**
- [x] `type-fest` 패키지 의존성 확인 (이미 있음)
- [x] `ToolCall.arguments`: `Record<string, unknown> | string` → `JsonObject | string`
- [x] `GeminiFunctionCall.args`: 동일하게 변경
- [x] `GeminiFunctionResponse.response`: `Record<string, unknown>` → `JsonObject`
- [x] 영향받는 파일들 업데이트
- [x] Typecheck/lint 통과

### US-013: Type Guards 개선 (as 제거)

**Description:** 개발자로서, 타입 가드에서 `as` 단언을 제거하고 proper narrowing을 사용합니다.

**Acceptance Criteria:**
- [ ] `isGeminiRequest`, `isGeminiResponse` 등 타입 가드 리팩토링
- [ ] `value as Record<string, unknown>` 대신 `'contents' in value` 패턴 사용
- [ ] 중첩 타입 검사에서 proper narrowing 적용
- [ ] 모든 타입 가드 테스트 작성
- [ ] Typecheck/lint 통과

### US-014: Tool Edge Graph 모델링

**Description:** 개발자로서, tool call/result를 명시적 edge로 모델링하여 Claude 엄격 인접성 규칙을 컴파일 타임에 보장합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/types/tool-edge.ts` 생성
- [x] `ToolCallEdge` 인터페이스: `{ id, name, arguments, issuedAtMessageIndex }`
- [x] `ToolResultEdge` 인터페이스: `{ toolCallId, content, status, producedAtMessageIndex }`
- [x] `validateToolEdges()` 함수: 모든 ToolResult가 해당 ToolCall을 가리키는지 검증
- [x] `linearizeForClaude()` 함수: edge 그래프를 Claude 엄격 인접성 형식으로 변환
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-015: Orphan Tool ID Recovery

**Description:** 개발자로서, context compaction 등으로 인해 tool ID가 불일치할 때 복구 로직을 적용합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/util/tool-id-recovery.ts` 생성
- [x] Pass 1: 정확한 ID 매칭
- [x] Pass 2: 함수명으로 매칭
- [x] Pass 3: "unknown_function" orphan 또는 첫 번째 사용 가능한 것 매칭
- [x] Fallback: 누락된 tool result에 대해 placeholder 생성
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-016: Antigravity Envelope Builder

**Description:** 개발자로서, Antigravity 전용 envelope 래퍼를 생성합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/envelope.ts` 생성
- [x] `buildAntigravityEnvelope()` 함수: `{ project, model, request, userAgent, requestId }` 생성
- [x] project ID 검증 (필수 필드)
- [x] requestId 자동 생성 (UUID v4)
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-017: Interleaved Thinking Hint 주입

**Description:** 개발자로서, Claude thinking 모델에 interleaved thinking 힌트를 시스템 지시문에 추가합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/thinking-hint.ts` 생성
- [x] 힌트 텍스트: "Interleaved thinking is enabled. You may think between tool calls..."
- [x] 기존 시스템 지시문에 append (문자열 또는 parts 배열 처리)
- [x] thinking 모델 + tools 있을 때만 적용
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-018: Golden Test Fixtures

**Description:** 개발자로서, 핵심 변환 로직에 대한 Golden test fixture를 작성합니다.

**Acceptance Criteria:**
- [x] `packages/core/test/fixtures/` 디렉토리 생성
- [x] `multi-tool-call.json`: 2개 tool call + 2개 result 시퀀스
- [ ] `schema-with-refs.json`: $ref, $defs, const 포함 스키마 → 정제 후 결과
- [ ] `cross-model-signature.json`: Claude/Gemini signature 정제 전후
- [ ] `orphan-tool-recovery.json`: ID 미매칭 → 복구 후 결과
- [ ] `empty-schema.json`: 빈 스키마 → placeholder 추가 결과
- [ ] 모든 fixture에 대한 스냅샷 테스트 작성
- [ ] Typecheck/lint 통과

### US-019: Schema $ref/$defs 인라인 확장

**Description:** 개발자로서, 스키마의 $ref/$defs를 description 힌트가 아닌 실제 인라인 확장으로 처리하여 구조를 보존합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/shared/schema-inliner.ts` 생성
- [x] `inlineSchemaRefs(schema)` 함수: 재귀적으로 $ref를 실제 스키마로 대체
- [x] 순환 참조 감지 및 fallback 처리: `{ type: "object", description: "Cyclic ref to X" }`
- [x] 최대 확장 깊이 제한 (configurable, 기본값 10)
- [x] 최대 노드 수 제한 (configurable, 스키마 폭발 방지)
- [x] 메모이제이션으로 중복 확장 방지
- [x] $defs, definitions 확장 후 제거
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-020: Schema allOf/anyOf/oneOf 병합

**Description:** 개발자로서, 스키마의 combinator를 Antigravity가 지원하는 형태로 병합합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/shared/schema-merger.ts` 생성
- [x] `mergeAllOf(schema)`: properties 병합, required는 union
- [x] `handleAnyOfOneOf(schema, strategy)`: Variant Wrapper 또는 Conservative Union 전략
- [x] 타입 충돌 시 더 구조화된 타입 선택 + description에 충돌 기록
- [x] Conservative Union: properties union, required intersection
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-021: Schema Preflight 검증

**Description:** 개발자로서, 정제된 스키마가 Antigravity API에서 동작할 수 있는지 사전 검증합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/shared/schema-validator.ts` 생성
- [x] `validateSanitizedSchema(schema)` 함수
- [x] 최상위 `type: "object"` 확인
- [x] properties에 1개 이상 키 존재 확인
- [x] required 키가 properties에 존재 확인
- [x] 미지원 키워드 잔류 여부 확인
- [x] 최대 중첩 깊이 검증
- [x] 검증 실패 시 상세 오류 반환
- [x] 테스트 파일 작성 및 통과
- [x] Typecheck/lint 통과

### US-022: Tool Name Codec (완전 가역 인코딩)

**Description:** 개발자로서, tool name을 완전 가역적으로 인코딩/디코딩하여 원본 정보를 100% 보존합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/util/tool-name-codec.ts` 생성
- [x] `encode(original)` 함수: Base64url 인코딩 + 't' prefix
- [x] `decode(encoded)` 함수: 't' prefix 제거 + Base64url 디코딩
- [x] 64자 초과 시: hash 기반 registry lookup ('h' prefix)
- [x] 100% 가역성: `decode(encode(x)) === x` 모든 입력에 대해 성립
- [x] 결정적 변환: 동일 입력 → 동일 출력
- [x] 테스트: 특수문자, 한글, 긴 이름, 충돌 케이스 모두 커버
- [x] Typecheck/lint 통과

### US-023: Fix Hub-and-Spoke Architecture (Recovery)

**Description:** 현재 모놀리식으로 구현된 `packages/core/src/formats/gemini/index.ts`를 PRD의 설계대로 분리하고, 누락된 PRD 태스크들을 완료해야 합니다.

**Acceptance Criteria:**
- [x] `packages/core/src/formats/gemini/antigravity/` 디렉토리 및 하위 파일 생성 (request.ts, wire-types.ts, claude.ts, gemini.ts)
- [x] `packages/core/src/formats/gemini/gemini-cli/` 디렉토리 및 하위 파일 생성
- [x] `packages/core/src/formats/gemini/streaming/` 디렉토리 및 상태머신 구현
- [x] `packages/core/src/formats/gemini/index.ts` 리팩토링: `AntigravityAdapter` 및 `GeminiCliAdapter`로 요청 위임
- [x] `packages/core/src/formats/google-gemini/types.ts` 의존성 제거 및 Wire Type 재정의
- [x] 누락된 단위 테스트 (`tool-pairing.test.ts`, `tool-name-codec.test.ts`) 작성

---

## Functional Requirements

### Tool Pairing (Claude Strict Adjacency)
- FR-1: 모든 `functionCall`은 `id` 필드를 가져야 함 (없으면 자동 생성)
- FR-2: **[Claude Only]** `functionResponse`는 해당 `functionCall`의 **바로 다음** 메시지에 위치해야 함
- FR-3: 여러 tool call이 한 메시지에 있으면, 다음 메시지에 모든 response가 같은 순서로 있어야 함
- FR-4: 누락된 tool result는 cancellation/error 결과로 합성
- FR-5: tool 관련 메시지는 `mergeSameRoles()`에서 merge 금지
- FR-6: tool_use와 tool_result 사이에 다른 메시지 삽입 금지

### Orphan Tool ID Recovery
- FR-7: Pass 1 - 정확한 ID 매칭으로 functionResponse를 functionCall에 연결
- FR-8: Pass 2 - ID 매칭 실패 시 함수명으로 매칭 시도
- FR-9: Pass 3 - "unknown_function" orphan 또는 첫 번째 사용 가능한 것으로 매칭
- FR-10: Fallback - 매칭 불가 시 placeholder response 생성

### Model Capabilities Detection
- FR-11: Claude 모델 감지: 모델명에 "claude" 포함 (case-insensitive)
- FR-12: Claude Thinking 모델 감지: "claude" + "thinking" 포함
- FR-13: Gemini 3 모델 감지: "gemini-3" 포함
- FR-14: Gemini 2.5 모델 감지: "gemini-2.5" 포함
- FR-15: Image Generation 모델 감지: "image" 또는 "imagen" 포함

### Wire Format - Antigravity
- FR-16: Envelope wrapper: `{ project, model, request, userAgent, requestId }` 형식 필수
- FR-17: System instruction: 반드시 `{ parts: [{ text }] }` 객체 형식 (문자열 불가)
- FR-18: Claude thinking config: snake_case (`thinking_config.include_thoughts`, `thinking_budget`)
- FR-19: Gemini 3 thinking config: camelCase + thinkingLevel (`thinkingConfig.includeThoughts`, `thinkingLevel`)
- FR-20: Gemini 2.5 thinking config: camelCase + thinkingBudget (`thinkingConfig.includeThoughts`, `thinkingBudget`)

### Headers
- FR-21: Antigravity `Client-Metadata`: JSON 형식 `{"ideType":"...","platform":"...","pluginType":"..."}`
- FR-22: Gemini-CLI `Client-Metadata`: key=value 형식 `ideType=...,platform=...`
- FR-23: Antigravity `User-Agent`: `antigravity/{version} {platform}/{arch}`
- FR-24: Antigravity `X-Goog-Api-Client`: `google-cloud-sdk vscode_cloudshelleditor/0.1`

### Schema Sanitization
- FR-25: `$ref` → description에 힌트로 변환 (`See: RefName`)
- FR-26: `$defs`, `definitions` → 제거 (인라인으로 펼침)
- FR-27: `$schema`, `$id`, `$comment` → 제거
- FR-28: `const` → `enum: [value]`로 변환
- FR-29: `default`, `examples` → description에 힌트로 이동 후 제거
- FR-30: `additionalProperties` → description에 힌트로 이동 후 제거
- FR-31: `minLength`, `maxLength`, `pattern`, `format` 등 제약사항 → description 이동

### Tool Name Codec (완전 가역 인코딩)
- FR-32: 모든 tool name은 Base64url 인코딩 + 't' prefix로 변환
- FR-33: 첫 글자 규칙 충족: 't' prefix로 항상 letter로 시작
- FR-34: 허용 문자 규칙 충족: Base64url은 `A-Za-z0-9_-`만 사용
- FR-35: 최대 64자 제한: 원본 47자까지 직접 인코딩, 초과 시 hash registry
- FR-36: 64자 초과 시: SHA256 hash (16자) + 'h' prefix → registry lookup
- FR-37: 100% 가역성: `decode(encode(x)) === x` 모든 입력에 대해 보장
- FR-38: Request 변환 시 encode(), Response 변환 시 decode() 적용

### Empty Schema Handling
- FR-39a: 빈 스키마 (properties 없음)는 placeholder 속성 추가 필수 (Claude VALIDATED 모드)

### Thinking Configuration
- FR-39: Claude 히스토리에서 thinking 블록 제거 (tool 블록은 유지)
- FR-40: Gemini signature가 없으면 `skip_thought_signature_validator` 사용
- FR-41: Claude `maxOutputTokens > thinkingBudget` 필수 (기본값 64000)
- FR-42: Claude thinking 모델 + tools 조합 시 interleaved thinking hint 추가

### Cross-Model Signature Sanitization
- FR-43: Claude → Gemini 전환 시 Claude signature/thinking 블록 제거
- FR-44: Gemini → Claude 전환 시 Gemini thoughtSignature/thinkingMetadata 제거
- FR-45: 정제는 idempotent (여러 번 적용해도 동일 결과)

### Tool Configuration
- FR-46: Claude: `toolConfig.functionCallingConfig.mode = "VALIDATED"` 설정
- FR-47: Tools는 `[{ functionDeclarations: [...] }]` 형식으로 래핑
- FR-48: googleSearchRetrieval, codeExecution 등 비함수 도구는 passthrough

---

## Non-Goals (Out of Scope)

- Standard Gemini API (generativelanguage.googleapis.com) 지원 - 향후 별도 추가
- OpenAI 포맷 변경
- Anthropic 포맷 변경
- 새로운 프로바이더 추가
- 스트리밍 성능 최적화 (기능 동작 우선)
- 캐싱 전략 변경

---

## Technical Considerations

### 디렉토리 구조
```
packages/core/src/
├── types/
│   ├── unified.ts               # UnifiedRequest, UnifiedResponse (Hub IR)
│   ├── tool-edge.ts             # ToolCallEdge, ToolResultEdge (명시적 edge 모델)
│   └── json.ts                  # JsonObject, JsonValue (type-fest re-export)
├── util/
│   ├── tool-pairing.ts          # enforceToolPairingAdjacency()
│   ├── tool-id-recovery.ts      # fixToolResponseGrouping(), assignToolIds()
│   ├── tool-name-codec.ts       # ToolNameCodec (encode/decode, 완전 가역) ⭐ NEW
│   └── tool-history.ts          # normalizeToolHistory() (리팩토링)
└── formats/
    └── gemini/
        ├── capabilities.ts              # resolveGeminiFamilyCapabilities()
        ├── shared/
        │   ├── schema-sanitizer.ts      # cleanSchemaForAntigravity() (파이프라인)
        │   ├── schema-inliner.ts        # inlineSchemaRefs() ⭐ NEW
        │   ├── schema-merger.ts         # mergeAllOf(), handleAnyOfOneOf() ⭐ NEW
        │   ├── schema-validator.ts      # validateSanitizedSchema() ⭐ NEW
        │   ├── signature-sanitizer.ts   # sanitizeCrossModelPayload()
        │   ├── tool-normalizer.ts       # wrapToolsAsFunctionDeclarations()
        │   └── tool-name-validator.ts   # validateToolName()
        ├── antigravity/
        │   ├── wire-types.ts            # AntigravityWireRequest, AntigravityInnerRequest
        │   ├── envelope.ts              # buildAntigravityEnvelope()
        │   ├── request.ts               # buildAntigravityWireRequest()
        │   ├── claude.ts                # applyClaudeTransforms()
        │   ├── gemini.ts                # applyGeminiTransforms()
        │   ├── system-instruction.ts    # ensureSystemInstructionObject()
        │   ├── thinking-hint.ts         # appendClaudeThinkingHint()
        │   └── headers.ts               # getAntigravityHeaders()
        ├── gemini-cli/
        │   ├── wire-types.ts            # GeminiCliWireRequest
        │   ├── request.ts               # buildGeminiCliWireRequest()
        │   └── headers.ts               # getGeminiCliHeaders()
        └── streaming/
            └── state-machine.ts         # StreamState, parseSSEChunk()

packages/core/test/
├── fixtures/
│   ├── multi-tool-call.json
│   ├── schema-with-refs.json
│   ├── cross-model-signature.json
│   ├── orphan-tool-recovery.json
│   └── empty-schema.json
└── formats/
    └── gemini/
        ├── tool-pairing.test.ts
        ├── schema-sanitizer.test.ts
        ├── signature-sanitizer.test.ts
        ├── claude.test.ts
        ├── gemini.test.ts
        └── streaming.test.ts
```

### 기존 코드 처리
- **⚠️ 완전 리팩토링**: `packages/core/src/formats/google-gemini/` 기존 파일은 새 구조로 완전 대체
- `normalizeToolHistory()` 함수는 새로운 `enforceToolPairingAdjacency()` 로직으로 교체
- 기존 코드 호환성 고려 불필요

### 의존성
- `type-fest`: 이미 설치됨 (`JsonObject`, `JsonValue`, `ReadonlyDeep` 등 사용)
- 새로운 패키지 추가 없음

### 타입 안전성 원칙
1. **`any` 금지**: 모든 타입 명시적으로 정의
2. **`unknown` 대신 구체적 타입**: JSON은 `JsonValue`/`JsonObject` 사용
3. **`Record<string, unknown>` 대신**: 구체적 인터페이스 정의
4. **`as` 타입 단언 금지**: proper type narrowing 사용 (`in` 연산자, discriminated union)
5. **`@ts-expect-error`, `biome-ignore` 금지**: 타입 문제 근본적 해결
6. **Discriminated Union 적극 활용**: 모델별 설정, 스트리밍 상태 등

### 타입 명명 규칙

**피해야 할 접두사/접미사:**
- ❌ `Wire`, `Internal`, `External` - 의미 모호

**권장 명명법 (역할 기반):**
| 개념 | 권장 이름 | 설명 |
|------|-----------|------|
| llmux 내부 정규화 형식 | `UnifiedRequest` | 모든 프로바이더에 공통 |
| 프로바이더 전송 형식 | `ProviderRequest` | 특정 프로바이더용 |
| Antigravity envelope 내부 | `AntigravityPayload` | envelope.request 필드 |
| 스트리밍 청크 | `StreamChunk` | SSE 파싱 결과 |

---

## Success Metrics

- Claude on Antigravity에서 tool pairing 400 에러 0건
- `any`, `as`, `@ts-expect-error`, `biome-ignore` 사용 0건 (Gemini 관련 코드)
- 모든 변환 로직 테스트 커버리지 90% 이상
- `bun run typecheck` 성공
- `bun run lint` 성공
- `bun run test` 모든 테스트 통과

---

## Open Questions

1. Standard Gemini API 지원은 언제 추가할 것인가?
2. 기존 `google-gemini` 폴더의 deprecated 코드는 언제 제거할 것인가?
3. Gemini-CLI 프로바이더도 별도 모듈로 분리할 것인가?
4. 스트리밍 state machine의 에러 복구 전략은?

---

## Appendix A: Claude vs Gemini on Antigravity 상세 차이점

### A.1 공통점 (Common Constraints)

| 항목 | 설명 |
|------|------|
| **Wire Format** | Gemini-style `contents[]` (role: `user` \| `model`, parts: [...]) |
| **Endpoint** | `cloudcode-pa.googleapis.com` (prod), `daily-cloudcode-pa.sandbox.googleapis.com` (daily) |
| **Envelope Wrapper** | `{ project, model, request, userAgent, requestId }` 형식 필수 |
| **Headers** | `Authorization`, `User-Agent`, `X-Goog-Api-Client`, `Client-Metadata` (JSON 형식) |
| **Tool Format** | `tools: [{ functionDeclarations: [...] }]` 형식 필수 |
| **System Instruction** | 반드시 `{ parts: [{ text: string }] }` 객체 형식 (문자열 불가) |
| **JSON Schema 미지원** | `$ref`, `$defs`, `definitions`, `$schema`, `$id`, `const`, `default`, `examples`, `additionalProperties` |
| **Tool Name 규칙** | `[A-Za-z_]`로 시작, `[a-zA-Z0-9_\-\.:]` 허용, `/` 불가, 최대 64자 |

### A.2 차이점 (Model-Specific Differences)

| 항목 | Claude | Gemini |
|------|--------|--------|
| **Thinking Config 키** | snake_case: `thinking_config.include_thoughts`, `thinking_budget` | camelCase: `thinkingConfig.includeThoughts` |
| **Thinking 파라미터** | `thinking_budget` (숫자) | Gemini 3: `thinkingLevel` (MINIMAL/LOW/MEDIUM/HIGH), Gemini 2.5: `thinkingBudget` (숫자) |
| **Tool Pairing** | **⚠️ 엄격 (Strict Adjacency)**: tool_result는 반드시 tool_use 직후 메시지에 위치 | 관대: 위치 유연 |
| **Tool Pairing Error** | 400: "unexpected tool_use_id found in tool_result blocks" | 일반적으로 에러 없음 |
| **Thinking History** | 히스토리에서 thinking 블록 **제거 권장** (tool 블록은 유지) | 유지 (signature 필요) |
| **Thought Signature** | 불필요 | 필요 (없으면 `skip_thought_signature_validator` 사용) |
| **Tool Config Mode** | `VALIDATED` 모드 권장 (스키마 검증 강화) | `AUTO` 기본 |
| **Max Output Tokens** | `> thinkingBudget` 필수 (64000 권장) | 관대 |
| **Response ID Format** | `msg_vrtx_...` | Base64-like |
| **Thinking Part 형식** | `{ thought: true, text, thoughtSignature }` | `{ thoughtSignature, text }` (thought 플래그 없음) |
| **Interleaved Thinking** | 지원 - 시스템 지시문에 힌트 추가 권장 | 지원 여부 모델별 상이 |

### A.3 Tool Pairing 엄격성 상세

**Claude 엄격 규칙 (반드시 준수):**
```
1. assistant 메시지에 tool_use 블록 포함
2. **바로 다음** user 메시지에 해당 tool_result 블록 포함
3. tool_result.tool_use_id === tool_use.id 매칭 필수
4. 한 assistant 메시지에 여러 tool_use가 있으면, 다음 user 메시지에 모든 tool_result가 동일 순서로
```

**Claude 400 에러 원인:**
- tool_result가 tool_use 직후가 아닌 다른 위치에 있음
- tool_use_id가 이전 assistant 메시지의 tool_use.id와 매칭 안됨
- tool_use와 tool_result 사이에 다른 메시지가 끼어있음

**Gemini 관대한 처리:**
- functionResponse가 functionCall 이후 어디든 위치 가능
- ID 매칭은 필요하지만 인접성 불요

---

## Appendix B: Antigravity vs Gemini-CLI 상세 차이점

### B.1 공통점

| 항목 | 설명 |
|------|------|
| **Wire Format** | Gemini-style `contents[]`, `parts[]` |
| **Authentication** | OAuth 2.0 Bearer Token |
| **Streaming** | SSE (Server-Sent Events), `alt=sse` 파라미터 |
| **Response Format** | `candidates[].content.parts[]` 구조 |

### B.2 차이점

| 항목 | Antigravity | Gemini-CLI |
|------|-------------|------------|
| **Endpoint** | `cloudcode-pa.googleapis.com/v1internal:*` | `cloudcode-pa.googleapis.com` (prod) - 동일하지만 헤더 다름 |
| **Envelope** | `{ project, model, request, userAgent, requestId }` 필수 | 직접 request body (envelope 없음) |
| **Client-Metadata 형식** | JSON: `{"ideType":"...","platform":"..."}` | key=value: `ideType=...,platform=...` |
| **User-Agent** | `antigravity/1.11.5 platform/arch` | CLI 전용 UA |
| **X-Goog-Api-Client** | `google-cloud-sdk vscode_cloudshelleditor/0.1` | 다른 값 사용 |
| **Multi-Model Support** | Claude, Gemini, GPT-OSS 모두 지원 | Gemini 전용 |
| **Model Routing** | 내부적으로 모델별 백엔드 라우팅 | 직접 호출 |
| **Project ID** | envelope에 `project` 필드 필수 | 별도 처리 |

### B.3 헤더 상세

**Antigravity 헤더:**
```http
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: antigravity/1.11.5 windows/amd64
X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
Client-Metadata: {"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}
```

**Gemini-CLI 헤더:**
```http
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: gemini-cli/x.x.x
Client-Metadata: ideType=GEMINI_CLI,platform=LINUX
```

---

## Appendix C: JSON Schema 제약사항 상세

### C.1 Antigravity API가 거부하는 필드

| 필드 | 처리 방법 |
|------|-----------|
| `$ref` | description에 힌트로 변환: `{ type: "object", description: "See: RefName" }` |
| `$defs`, `definitions` | 제거 (인라인으로 펼침) |
| `$schema`, `$id`, `$comment` | 제거 |
| `const` | `enum: [value]`로 변환 |
| `default`, `examples` | description에 힌트로 이동 후 제거 |
| `additionalProperties` | description에 힌트로 이동 후 제거 |
| `title` (중첩) | 중첩된 경우 문제 발생 가능, 제거 권장 |
| `minLength`, `maxLength`, `pattern` | description에 힌트로 이동 |
| `minItems`, `maxItems` | description에 힌트로 이동 |
| `exclusiveMinimum`, `exclusiveMaximum` | description에 힌트로 이동 |
| `format` | description에 힌트로 이동 |

### C.2 스키마 정제 파이프라인 순서 (개선된 전략)

**핵심 원칙: "Hint-and-drop" 대신 "Structural Preservation" 우선**

```
1. Phase 1: $ref/$defs 인라인 확장 (힌트가 아닌 실제 구조 보존)
   - 내부 참조 (#/$defs/X, #/definitions/X) 재귀적으로 인라인
   - 순환 참조 감지 시 { type: "object", description: "Cyclic ref to X" }로 대체
   - 최대 확장 깊이 제한 (8-20)
   - 메모이제이션으로 중복 확장 방지
   
2. Phase 2: allOf 실제 병합 (description 연결이 아닌 구조 병합)
   - 모든 subschema가 object면 properties 병합, required는 union
   - 타입 충돌 시 더 구조화된 타입 선택 + description에 충돌 기록
   
3. Phase 3: anyOf/oneOf 처리 (두 가지 전략)
   - 전략 A (권장): Variant Wrapper 패턴
     { _variant: "A|B|C", value: {...} } 형태로 변환
   - 전략 B (형태 보존 필요시): Conservative Union
     properties: 모든 variant의 union, required: 모든 variant의 intersection
     
4. Phase 4: 미지원 키워드 → 구조적 등가물 변환
   - const → enum: [value] (지원되면 유지)
   - minLength/maxLength/pattern/format → 간결한 단일 힌트
   
5. Phase 5: Preflight 검증
   - 최상위 type: "object" 확인
   - properties에 1개 이상 키 존재
   - required 키가 properties에 존재
   - 미지원 키워드 잔류 여부 확인
   - 최대 중첩 깊이 검증
```

**$ref 인라인 vs 힌트 변환 비교:**
| 방식 | 장점 | 단점 |
|------|------|------|
| 힌트 변환 | 간단, 스키마 폭발 없음 | 구조 손실, 모델이 힌트 무시 가능 |
| 인라인 확장 | 구조 완전 보존, 필드명/required 유지 | 스키마 크기 증가, 순환 참조 처리 필요 |

**권장: 인라인 확장 + 깊이/노드 수 제한**

### C.3 빈 스키마 처리

```typescript
// 빈 스키마는 placeholder 추가 필요 (Claude VALIDATED 모드)
{
  type: "object",
  properties: {
    _placeholder: {
      type: "boolean",
      description: "Placeholder. Always pass true."
    }
  },
  required: ["_placeholder"]
}
```

---

## Appendix C-Extra: Tool Name 가역적 인코딩 전략

### 현재 접근법의 문제점

```typescript
// 현재: 단순 replace - 정보 손실 발생
name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
```

| 원본 이름 | 변환 결과 | 문제 |
|-----------|-----------|------|
| `mcp/mongodb/query` | `mcp_mongodb_query` | 원본 복원 불가 |
| `foo/bar` | `foo_bar` | `foo_bar` 원본과 충돌 |
| `foo_bar` | `foo_bar` | 위와 구분 불가 |

### 개선된 전략: 완전 가역 인코딩

**핵심 원칙: 항상 인코딩, 항상 디코딩 - 예외/조건 분기 없음**

어떤 escape 시퀀스나 prefix도 원본에 존재할 수 있으므로, **전체를 항상 인코딩**하여 100% 가역성 보장.

```typescript
import { createHash } from 'crypto';

/**
 * Tool Name Codec - 완전 가역 인코딩/디코딩
 * 
 * Request 변환: encode(original) → API 전송
 * Response 변환: decode(encoded) → 원본 복원
 */
class ToolNameCodec {
  // 64자 초과 시 hash lookup용 registry
  private hashToOriginal = new Map<string, string>();
  
  encode(original: string): string {
    // Base64url 인코딩 (A-Za-z0-9_- 만 사용)
    const b64 = Buffer.from(original, 'utf-8').toString('base64url');
    
    // 't' prefix: 첫 글자 규칙 충족 (letter로 시작 필수)
    const encoded = 't' + b64;
    
    if (encoded.length <= 64) {
      return encoded;
    }
    
    // 64자 초과: hash 기반 registry lookup
    const hash = createHash('sha256')
      .update(original)
      .digest('base64url')
      .slice(0, 16);
    
    this.hashToOriginal.set(hash, original);
    return 'h' + hash; // 17자, 'h' = hash lookup indicator
  }
  
  decode(encoded: string): string {
    if (encoded[0] === 'h') {
      // Hash lookup
      const hash = encoded.slice(1);
      const original = this.hashToOriginal.get(hash);
      if (!original) {
        throw new Error(`Unknown tool hash: ${hash}`);
      }
      return original;
    }
    
    // Base64url 디코딩 ('t' prefix 제거)
    return Buffer.from(encoded.slice(1), 'base64url').toString('utf-8');
  }
}
```

### 변환 예시

| 원본 | 인코딩 | 디코딩 | 가역 |
|------|--------|--------|------|
| `read-file` | `tcmVhZC1maWxl` | `read-file` | ✅ |
| `mcp/query` | `tbWNwL3F1ZXJ5` | `mcp/query` | ✅ |
| `foo_bar` | `tZm9vX2Jhcg` | `foo_bar` | ✅ |
| `foo/bar` | `tZm9vL2Jhcg` | `foo/bar` | ✅ |
| `123tool` | `tMTIzdG9vbA` | `123tool` | ✅ |
| `_e_fake` | `tX2VfZmFrZQ` | `_e_fake` | ✅ |
| `한글도구` | `t7ZWc6riA64-E6rWs` | `한글도구` | ✅ |
| `very_long_name_...` (60자) | `hAbC123...` (17자) | (registry) | ✅ |

### 왜 이 방식인가?

| 방식 | 가역성 | 충돌 | 조건분기 | 복잡도 |
|------|--------|------|----------|--------|
| Replace (`/` → `_`) | ❌ | 있음 | 없음 | 낮음 |
| Escape (`/` → `__S__`) | ⚠️ | `__S__` 원본 시 문제 | 있음 | 중간 |
| Prefix 기반 (`_e_...`) | ⚠️ | `_e_` 원본 시 문제 | 있음 | 중간 |
| **완전 인코딩** | ✅ | 없음 | 없음 | 낮음 |

**완전 인코딩의 장점:**
- 100% 결정적: 동일 입력 → 동일 출력
- 100% 가역: 어떤 원본도 완벽 복원
- 충돌 없음: 서로 다른 원본 → 서로 다른 인코딩
- 조건 분기 없음: 항상 인코딩, 항상 디코딩 (단순함)

### 64자 제한 처리

Base64는 4/3 길이 증가 → 원본 최대 **47자**까지 직접 인코딩.

```
원본 47자 → Base64 63자 + 't' prefix = 64자 ✅
원본 48자 → Base64 64자 + 't' prefix = 65자 ❌ → hash registry 사용
```

긴 이름은 hash 기반 registry로 처리:
- Request 시: hash 계산 → registry에 원본 저장 → `h{hash}` 반환
- Response 시: `h`로 시작하면 registry에서 원본 조회

---

## Appendix D: 400 에러 원인 및 방지 전략

### D.1 높은 확률로 발생하는 400 에러

| 에러 원인 | 영향 범위 | 방지 전략 |
|-----------|-----------|-----------|
| Tool result 인접성 위반 | Claude | `enforceToolPairingAdjacency()` 적용 |
| tool_use_id 미매칭 | Claude | 모든 tool call에 고유 ID 보장, 응답 ID 매칭 |
| 잘못된 tool name | 전체 | regex 검증: `/^[A-Za-z_][a-zA-Z0-9_\-.:]*$/`, 64자 제한 |
| $ref, $defs, const 스키마 | 전체 | 스키마 정제 파이프라인 적용 |
| 문자열 system instruction | 전체 | 객체 형식으로 변환 |
| Gemini parts를 Claude에 전송 | Claude | cross-model sanitizer 적용 |
| text + tool_result 같은 메시지 | Claude | 분리하거나 tool_result만 포함 |

### D.2 Silent Failure (에러 없이 오동작)

| 현상 | 원인 | 감지 방법 |
|------|------|-----------|
| 모델이 도구 호출 안함 | functionDeclarations 형식 오류 | 도구 호출 로깅, 테스트 |
| 도구 호출 인자 누락/오류 | 스키마 과도한 정제 | 정제 전후 diff 로깅 |
| Thinking 무시됨 | 미지원 모델에 thinking 설정 | 모델 capabilities 체크 |

### D.3 순서 의존성

| 단계 | 설명 | 의존성 |
|------|------|--------|
| 1 | Cross-model signature 정제 | 가장 먼저 (다른 모델 아티팩트 제거) |
| 2 | Tool ID 할당 | tool call 전에 |
| 3 | Schema 정제 | tool declarations 전에 |
| 4 | Tool pairing 정규화 | contents 조립 전에 |
| 5 | System instruction 변환 | envelope 조립 전에 |
| 6 | Envelope wrapping | 마지막 |

---

## Appendix E: 구현 전략

### E.1 핵심 원칙

1. **Hub IR에서 tool call/result를 명시적 edge로 표현**
   - Claude 엄격 인접성을 어댑터 레벨에서 컴파일 타임 보장
   - Gemini는 동일 IR 사용하되 인접성 강제 불필요

2. **Discriminated Union으로 모델별 설정 분리**
   ```typescript
   type ThinkingConfig = 
     | { kind: 'claude'; enabled: boolean; budgetTokens?: number }
     | { kind: 'gemini-3'; enabled: boolean; thinkingLevel: ThinkingLevel }
     | { kind: 'gemini-2.5'; enabled: boolean; thinkingBudget?: number };
   ```

3. **공유 정제기 (Shared Sanitizers)**
   - `sanitizeToolDefinitions(target)`
   - `sanitizeJsonSchema(target)`
   - `sanitizeCrossModelSignatures(target)`

4. **어댑터별 책임**
   - AntigravityClaudeAdapter: 엄격 tool 인접성 + snake_case thinking
   - AntigravityGeminiAdapter: camelCase thinking + thinkingLevel/Budget 분기
   - GeminiCliAdapter: 직접 호출 형식 + 다른 헤더

### E.2 Golden Test Fixtures 필수 케이스

1. **Multi-tool call sequence**: 한 assistant 메시지에 2개 tool call → 다음 user 메시지에 2개 result
2. **Schema with $ref/$defs/const**: 정제 후 400 에러 없음 확인
3. **Cross-model signature**: Claude signature가 Gemini로 전송 시 제거됨
4. **Orphan tool ID recovery**: tool result ID 미매칭 시 복구 로직
5. **Empty schema placeholder**: 빈 스키마가 placeholder로 변환됨
