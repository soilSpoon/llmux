# OpenAI Responses API 지원 구현 플랜

## Overview
- **Feature**: OpenAI Responses API (`/v1/responses`) 엔드포인트 지원
- **Status**: ⏳ Pending
- **Priority**: High
- **Estimated Time**: 4 hours
- **Last Updated**: 2024-12-26

## Background
최신 AI SDK (`@ai-sdk/openai@3.x`)는 OpenAI Responses API를 기본으로 사용합니다. 
llmux 서버가 이 엔드포인트를 지원해야 AI SDK와 호환됩니다.

### OpenAI Responses API vs Chat Completions API
| 항목 | Chat Completions | Responses |
|------|------------------|-----------|
| Endpoint | `/v1/chat/completions` | `/v1/responses` |
| Input field | `messages` | `input` |
| Output | `choices[0].message` | `output[0].content` |
| Streaming | `data: {...}` | Semantic events |

## Phases

### Phase 1: Core Types 정의 (30분)
**Status**: ⏳ Pending
**Risk Level**: 🟢 Low

**Tasks**:
- [ ] 1.1 `ResponsesRequest` 타입 정의 (input, model, instructions, stream 등)
- [ ] 1.2 `ResponsesResponse` 타입 정의 (id, object, output, usage 등)
- [ ] 1.3 `ResponsesStreamEvent` 타입 정의 (response.created, response.output_text.delta 등)

**Quality Gate**:
- [ ] `bun run typecheck` 통과

---

### Phase 2: Request 변환 로직 (TDD) (1시간)
**Status**: ⏳ Pending  
**Risk Level**: 🟡 Medium

**Tasks**:
- [ ] 2.1 테스트 작성: `responses-transformer.test.ts`
  - [ ] 2.1.1 간단한 텍스트 input 변환 테스트
  - [ ] 2.1.2 messages 배열 형태 input 변환 테스트
  - [ ] 2.1.3 instructions 필드 처리 테스트
- [ ] 2.2 `transformResponsesRequest()` 구현
  - [ ] 2.2.1 input → messages 변환
  - [ ] 2.2.2 instructions → system message 변환
  - [ ] 2.2.3 기타 필드 매핑 (temperature, max_output_tokens 등)

**Quality Gate**:
- [ ] `bun test` 통과
- [ ] `bun run typecheck` 통과

---

### Phase 3: Response 변환 로직 (TDD) (1시간)
**Status**: ⏳ Pending
**Risk Level**: 🟡 Medium

**Tasks**:
- [ ] 3.1 테스트 작성: `responses-transformer.test.ts` (추가)
  - [ ] 3.1.1 Chat Completions 응답 → Responses 형식 변환 테스트
  - [ ] 3.1.2 usage 필드 변환 테스트
  - [ ] 3.1.3 output 배열 구조 테스트
- [ ] 3.2 `transformToResponsesResponse()` 구현
  - [ ] 3.2.1 choices → output 변환
  - [ ] 3.2.2 usage 필드 변환
  - [ ] 3.2.3 id, object, created_at 필드 생성

**Quality Gate**:
- [ ] `bun test` 통과
- [ ] `bun run typecheck` 통과

---

### Phase 4: Streaming 변환 로직 (TDD) (1시간)
**Status**: ⏳ Pending
**Risk Level**: 🟠 High

**Tasks**:
- [ ] 4.1 테스트 작성: `responses-streaming.test.ts`
  - [ ] 4.1.1 Chat Completions SSE → Responses SSE 이벤트 변환 테스트
  - [ ] 4.1.2 response.created 이벤트 생성 테스트
  - [ ] 4.1.3 response.output_text.delta 이벤트 변환 테스트
  - [ ] 4.1.4 response.completed 이벤트 생성 테스트
- [ ] 4.2 `ResponsesStreamTransformer` 구현
  - [ ] 4.2.1 SSE 파서 (Chat Completions 형식)
  - [ ] 4.2.2 Responses 이벤트 생성기
  - [ ] 4.2.3 TransformStream 래퍼

**Quality Gate**:
- [ ] `bun test` 통과
- [ ] `bun run typecheck` 통과

---

### Phase 5: 라우트 등록 및 핸들러 (30분)
**Status**: ⏳ Pending
**Risk Level**: 🟡 Medium

**Tasks**:
- [ ] 5.1 `handleResponses()` 핸들러 함수 구현
  - [ ] 5.1.1 Non-streaming 처리
  - [ ] 5.1.2 Streaming 처리
- [ ] 5.2 라우트 등록
  - [ ] 5.2.1 `/v1/responses` 라우트 추가 (server.ts)
  - [ ] 5.2.2 `/api/provider/:provider/v1/responses` 라우트 추가 (amp/routes.ts)

**Quality Gate**:
- [ ] `bun test` 통과
- [ ] `bun run typecheck` 통과
- [ ] `bun run build` 통과

---

### Phase 6: E2E 테스트 및 예제 (30분)
**Status**: ⏳ Pending
**Risk Level**: 🟢 Low

**Tasks**:
- [ ] 6.1 통합 테스트 작성
  - [ ] 6.1.1 서버 시작 → /responses 호출 → 응답 검증
  - [ ] 6.1.2 스트리밍 테스트
- [ ] 6.2 예제 스크립트 업데이트
  - [ ] 6.2.1 `ai-sdk-gemini.ts` 동작 확인
- [ ] 6.3 README 업데이트

**Quality Gate**:
- [ ] `bun test` 통과
- [ ] 예제 스크립트 실행 성공

---

## Notes
- OpenAI Responses API는 Chat Completions의 상위 호환
- 최소 구현 범위: 텍스트 input/output, streaming
- 추후 확장: tools, function calling, structured outputs

## Dependencies
- `@llmux/core` 패키지의 기존 변환 로직 활용 가능

## Files to Create/Modify
### Create
- `packages/server/src/handlers/responses.ts`
- `packages/server/src/handlers/__tests__/responses.test.ts`
- `packages/server/src/handlers/__tests__/responses-streaming.test.ts`
- `packages/core/src/responses/types.ts`
- `packages/core/src/responses/transformer.ts`
- `packages/core/src/responses/__tests__/transformer.test.ts`

### Modify
- `packages/server/src/server.ts` (라우트 추가)
- `packages/server/src/amp/routes.ts` (Amp 라우트 추가)
- `llmux/README.md` (문서 업데이트)
