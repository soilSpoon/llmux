# PRD: Thinking & Casing Refactor

## Introduction

llmux의 "thinking" 파라미터 처리와 camelCase/snake_case 변환 로직을 근본적으로 개선한다. 현재 `isThinkingEnabled` 플래그가 4개 이상의 레이어를 통해 전달되고, 케이스 변환이 여러 곳에서 분산 처리되어 유지보수가 어렵다.

Hub-and-Spoke 아키텍처에 맞게:
- 내부는 camelCase 통일
- Provider 경계에서만 snake_case 직렬화
- 단일 `ThinkingPolicy`로 thinking 결정 중앙화

**참고 라이브러리:**
- Vercel AI SDK: `LanguageModelV3` 인터페이스 + provider별 `getArgs()` 패턴
- LiteLLM: `_camelToSnake()`, `_snakeToCamel()`, `_get_equivalent_key()` 유틸
- OpenCode: `transform.ts`의 `options()` 함수 + provider별 thinking config
- opencode-antigravity-auth: Antigravity 통신 모범 사례

## Goals

- 케이스 변환 유틸리티를 `@llmux/core`에 중앙화
- `ThinkingPolicy` 타입 도입으로 thinking 결정 단일화
- Provider 경계에서만 snake_case 직렬화 수행
- `isThinkingEnabled` 플럼빙 최소화 (4+ layers → 필요한 곳만)
- 기존 provider 포맷(antigravity, gemini-cli, openai, anthropic) 동작 유지
- 참고 라이브러리들과의 호환성 확보

## User Stories

### US-001: 문제 있는 thinking 강제 로직 롤백
**Description:** As a developer, I want to remove the forced thinking budget/includeThoughts logic so that user intent is respected.

**Acceptance Criteria:**
- [ ] `transform-pipeline.ts`에서 `budget: 1024` 강제 설정 코드 삭제
- [ ] `transform-pipeline.ts`에서 `includeThoughts: true` 강제 설정 코드 삭제
- [ ] `isThinkingEnabled === false || isClaudeFresh` 시 disable 로직만 유지
- [ ] 기존 테스트 통과 (`bun run test`)
- [ ] Typecheck 통과 (`bun run typecheck`)

### US-002: camelToSnake/snakeToCamel 유틸리티 생성
**Description:** As a developer, I want reusable case conversion utilities so that I don't duplicate conversion logic across providers.

**Acceptance Criteria:**
- [ ] `@llmux/core/src/utils/casing.ts` 생성
- [ ] `camelToSnakeKey(key: string): string` 함수 구현
- [ ] `snakeToCamelKey(key: string): string` 함수 구현
- [ ] 단위 테스트: 기본 변환 (`thinkingBudget` → `thinking_budget`)
- [ ] 단위 테스트: 연속 대문자 처리 (`XMLParser` → `xml_parser`)
- [ ] `@llmux/core` index에서 export
- [ ] Typecheck 통과

### US-003: convertKeysDeep 재귀 변환 유틸리티 생성
**Description:** As a developer, I want a deep key conversion utility so that I can transform entire request objects at provider boundaries.

**Acceptance Criteria:**
- [ ] `convertKeysDeep<T>(value: T, converter: KeyConverter, options?): T` 함수 구현
- [ ] 중첩 객체 변환 테스트
- [ ] 배열 내 객체 변환 테스트
- [ ] `null`, `undefined`, primitive 값 보존 테스트
- [ ] `preserveKeys` 옵션으로 특정 키 제외 테스트
- [ ] Typecheck 통과

### US-004: ThinkingPolicy 타입 정의
**Description:** As a developer, I want a single ThinkingPolicy type so that thinking decisions are centralized and explicit.

**Acceptance Criteria:**
- [ ] `@llmux/core/src/thinking/thinking-policy.ts` 생성
- [ ] `ThinkingPolicy` 타입 정의 (enabled, mode, includeThoughtsInResponse, sendThinkingToUpstream, reason)
- [ ] 타입이 `@llmux/core`에서 export됨
- [ ] Typecheck 통과

### US-005: computeThinkingPolicy 함수 구현
**Description:** As a developer, I want a function that computes thinking policy from inputs so that I don't scatter thinking logic across layers.

**Acceptance Criteria:**
- [ ] `computeThinkingPolicy()` 함수 구현
- [ ] 입력: model, mode, clientThinking, optionsThinking, isClaudeFresh, sourceFormat, targetProvider
- [ ] 단위 테스트: Claude Fresh → enabled: false
- [ ] 단위 테스트: thinking model + streaming → interleaved mode
- [ ] 단위 테스트: explicit client thinking config 우선
- [ ] 단위 테스트: non-thinking model → enabled: false
- [ ] Typecheck 통과

### US-006: isThinkingModel 헬퍼를 capabilities 테이블로 교체
**Description:** As a developer, I want model capability detection to be table-driven so that string matching heuristics are not scattered.

**Acceptance Criteria:**
- [ ] `@llmux/core/src/thinking/model-capabilities.ts` 생성
- [ ] `isThinkingModel(model: string, provider: string): boolean` 함수
- [ ] capabilities 테이블 정의 (regex/prefix 기반)
- [ ] 기존 `includes('thinking')` 호출을 새 헬퍼로 교체
- [ ] 단위 테스트: claude-3-7-sonnet-thinking → true
- [ ] 단위 테스트: gemini-3-pro → true
- [ ] 단위 테스트: gpt-4o → false
- [ ] Typecheck 통과

### US-007: PrepareUpstreamOptions에서 isThinkingEnabled를 thinkingPolicy로 교체
**Description:** As a developer, I want upstream options to use ThinkingPolicy so that providers receive structured decisions.

**Acceptance Criteria:**
- [ ] `PrepareUpstreamOptions.isThinkingEnabled` 삭제
- [ ] `PrepareUpstreamOptions.thinkingPolicy?: ThinkingPolicy` 추가
- [ ] 관련 호출 사이트 업데이트 (upstream-request-builder, strategies)
- [ ] Typecheck 통과

### US-008: transform-pipeline에서 ThinkingPolicy 사용
**Description:** As a developer, I want the transform pipeline to use ThinkingPolicy so that thinking overrides are policy-driven.

**Acceptance Criteria:**
- [ ] `executeTransformPipeline` 시그니처에서 `isThinkingEnabled` → `thinkingPolicy`
- [ ] policy 기반 thinking disable/enable 로직
- [ ] `removeThinkingFromBody` 호출을 policy 기반으로 변경
- [ ] Typecheck 통과

### US-009: Antigravity provider에서 snake_case 직렬화
**Description:** As a developer, I want Antigravity provider to serialize to snake_case at the boundary so that conversion is not scattered.

**Acceptance Criteria:**
- [ ] `transform-utils.ts`에서 `convertToSnakeCaseThinkingConfig()` 호출 제거
- [ ] Antigravity transform에서 `convertKeysDeep()` 사용하여 최종 직렬화
- [ ] `thinking_config`, `include_thoughts`, `thinking_budget` 키가 wire format에만 존재
- [ ] opencode-antigravity-auth 라이브러리와 동일한 요청 형식 검증
- [ ] Typecheck 통과

### US-010: anthropic-beta 헤더 로직을 ThinkingPolicy 기반으로 변경
**Description:** As a developer, I want anthropic-beta header logic to use ThinkingPolicy so that header decisions are centralized.

**Acceptance Criteria:**
- [ ] `antigravity.ts`에서 `model.includes('thinking')` 로직 제거
- [ ] `thinkingPolicy.mode === 'interleaved'` 시 anthropic-beta 헤더 추가
- [ ] 헤더 추가 로직이 upstream strategy 내에서만 수행
- [ ] Typecheck 통과

### US-011: streaming 파서에서 thoughtSignature 처리 유지
**Description:** As a developer, I want streaming parser to handle both camelCase and snake_case thoughtSignature so that responses are correctly parsed.

**Acceptance Criteria:**
- [ ] `streaming.ts`의 `thoughtSignature || thought_signature` 로직 유지
- [ ] 스트리밍 응답 파싱 테스트
- [ ] Typecheck 통과

### US-012: E2E 테스트 - Antigravity thinking 요청
**Description:** As a developer, I want E2E tests verifying Antigravity thinking requests so that the refactor doesn't break production.

**Acceptance Criteria:**
- [ ] E2E 테스트: thinking model + streaming → 올바른 헤더/body
- [ ] E2E 테스트: non-thinking model → thinking config 없음
- [ ] E2E 테스트: Claude Fresh → thinking disabled
- [ ] opencode-antigravity-auth 라이브러리 기준 요청 형식 검증

### US-013: E2E 테스트 - OpenAI/Anthropic 포맷 호환성
**Description:** As a developer, I want E2E tests verifying format compatibility so that existing clients continue to work.

**Acceptance Criteria:**
- [ ] E2E 테스트: OpenAI format → Antigravity 변환 정상
- [ ] E2E 테스트: Anthropic format → Antigravity 변환 정상
- [ ] E2E 테스트: Gemini CLI format 정상
- [ ] 참고 라이브러리들(ai, litellm, opencode)의 요청 패턴 호환

## Functional Requirements

- FR-1: `@llmux/core`에 `camelToSnakeKey`, `snakeToCamelKey`, `convertKeysDeep` 유틸리티 제공
- FR-2: `ThinkingPolicy` 타입으로 thinking 결정 표현
- FR-3: `computeThinkingPolicy()`로 요청 초기에 thinking policy 계산
- FR-4: Provider 경계에서만 snake_case 직렬화 수행
- FR-5: `isThinkingEnabled` boolean 대신 `ThinkingPolicy` 객체 전달
- FR-6: Model capabilities를 테이블 기반으로 조회
- FR-7: 기존 provider 포맷(antigravity, gemini-cli, openai, anthropic) 완전 호환

## Non-Goals

- 새로운 provider 추가 (Manus, Azure 등)
- 클라이언트 SDK 변경
- 기존 API 시그니처의 하위 호환성 (Breaking change 허용)
- 성능 최적화 (기능 정확성 우선)

## Technical Considerations

- **참고 라이브러리:**
  - Vercel AI SDK (`/home/dh/dev/CLIProxyAPI/ai`): `LanguageModelV3` 패턴
  - LiteLLM (`/home/dh/dev/CLIProxyAPI/litellm`): 케이스 변환 유틸
  - OpenCode (`/home/dh/dev/CLIProxyAPI/opencode`): provider transform 패턴
  - opencode-antigravity-auth (`/home/dh/dev/CLIProxyAPI/opencode-antigravity-auth`): Antigravity 모범 사례

- **기존 동작 검증:**
  - 참고 라이브러리들이 현재 잘 동작하므로, 해당 라이브러리들의 요청/응답 패턴을 기준으로 테스트 작성

- **TDD 접근:**
  - 각 Phase별로 테스트 먼저 작성 후 구현
  - 마지막에 E2E 테스트로 전체 동작 검증

## Success Metrics

- 모든 단위 테스트 통과 (`bun run test`)
- Typecheck 통과 (`bun run typecheck`)
- Lint 통과 (`bun run lint`)
- E2E 테스트로 기존 provider 포맷 호환성 검증
- `isThinkingEnabled` 키워드가 코드베이스에서 제거됨 (ThinkingPolicy로 대체)
- snake_case 변환이 provider transform 파일에서만 발생

## Open Questions

- `ThinkingPolicy.mode`의 정확한 값들은? (off, standard, interleaved 외에 필요한 것?)
- Claude Fresh 감지 로직의 정확한 조건은?
- Gemini 3의 `thinkingLevel` (minimal, low, medium, high)을 policy에 어떻게 매핑?
