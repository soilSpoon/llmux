# Unified Streaming Model 개선 계획

## 개요

Amp API 트래픽 분석 결과 발견된 갭을 **llmux Hub-and-Spoke 아키텍처**에 맞게 **Unified 레벨**에서 해결하는 구현 계획.

**핵심 원칙**: 
- Provider-specific 문제를 Provider-agnostic한 Unified 모델로 해결
- 모든 Provider (OpenAI, Anthropic, Gemini, Antigravity)에 일관되게 적용

**목표**: Provider-agnostic 스트리밍 이벤트 모델 완성

**예상 소요 시간**: 5-7시간

**위험도**: Medium (Unified 타입 변경으로 모든 Provider 영향)

**Last Updated**: 2026-01-01

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│  Source Stream (Anthropic SSE)                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AnthropicProvider.parseStreamChunk()                       │
│  → StreamChunk (blockIndex, blockType, block_stop 포함)     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Unified StreamChunk (Hub) - Provider-Agnostic              │
│  blockIndex, blockType, type: 'block_stop' 등               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  OpenAIProvider.transformStreamChunk()                      │
│  → OpenAI SSE (choices[].delta)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Unified 타입 확장 (P0 - Foundation)

**Status**: ✅ Complete  
**예상 시간**: 1시간  
**위험도**: 🟠 High (모든 Provider 영향)

### 1.1 StreamChunk 타입 확장

**파일**: `packages/core/src/types/unified.ts`

- [x] `StreamChunk`에 새 필드 추가
  - `type`에 `'block_stop' | 'tool_result'` 추가
  - `blockIndex?: number` 추가
  - `blockType?: ContentPart['type']` 추가

### 1.2 ThinkingBlock 타입 확장

- [x] `ThinkingBlock`에 `redacted?: boolean` 필드 추가

### 1.3 StreamDelta 타입 확장 (선택)

- [ ] Phase 5로 연기 (`parsedArguments` 필드는 JsonAccumulator 유틸리티에서 처리)

### Quality Gates
- [x] `bun run build`
- [x] `bun run typecheck` - 모든 Provider에서 타입 오류 확인

---

## Phase 2: Anthropic Provider 개선 (P0 - Primary)

**Status**: ⏳ Pending  
**예상 시간**: 2시간  
**위험도**: 🟡 Medium

### 2.1 SSE → Unified 변환 (수신)

**파일**: `packages/core/src/providers/anthropic/streaming.ts`

- [ ] `handleContentBlockStart` - blockIndex 추가
- [ ] `handleContentBlockDelta` - blockIndex 추가
- [ ] `handleContentBlockStop` - 새 함수 추가 (null 대신 block_stop 반환)

```typescript
function handleContentBlockStop(event: AnthropicContentBlockStopEvent): StreamChunk {
  return {
    type: 'block_stop',
    blockIndex: event.index,
    blockType: 'text', // 또는 컨텍스트에서 추론
  }
}
```

### 2.2 Unified → SSE 변환 (송신)

- [ ] `convertChunkToSSE` - `chunk.blockIndex ?? 0` 사용
- [ ] `block_stop` → `content_block_stop` 변환 추가

### 2.3 Response tool_result 파싱

**파일**: `packages/core/src/providers/anthropic/response.ts`

- [ ] `parseContentBlock`에 `tool_result` case 추가

### 2.4 redacted_thinking 처리

- [ ] `parseContentBlock`의 `redacted_thinking` → `ThinkingBlock.redacted = true`

### 2.5 JSON.parse 에러 방어

**파일**: `packages/core/src/providers/anthropic/request.ts`

- [ ] `transformPart` tool_call에 try/catch 추가

### 테스트
- [ ] `packages/core/test/providers/anthropic/streaming-index.test.ts`
- [ ] `packages/core/test/providers/anthropic/block-stop.test.ts`
- [ ] `packages/core/test/providers/anthropic/tool-result-response.test.ts`
- [ ] `packages/core/test/providers/anthropic/redacted-thinking.test.ts`
- [ ] `packages/core/test/providers/anthropic/json-parse-safety.test.ts`

### Quality Gates
- [ ] `bun run build`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run lint`

---

## Phase 3: OpenAI Provider 적용 (P1 - Consistency)

**Status**: ⏳ Pending  
**예상 시간**: 1시간  
**위험도**: 🟢 Low

### 3.1 OpenAI 스트리밍에 blockIndex 적용

**파일**: `packages/core/src/providers/openai/streaming.ts`

- [ ] `parseStreamChunk`에서 `blockIndex = choice.index` 설정

```typescript
// OpenAI choices[].index → Unified blockIndex
return {
  type: 'content',
  blockIndex: choice.index,  // 보통 0
  delta: { text: choice.delta?.content || '' },
}
```

- [ ] `finish_reason` → `block_stop` + `done` 분리 (선택)

### 3.2 역변환 (Unified → OpenAI)

- [ ] `transformStreamChunk`에서 `blockIndex` 반영

### 테스트
- [ ] 기존 OpenAI 스트리밍 테스트가 blockIndex 0으로 통과하는지 확인

### Quality Gates
- [ ] `bun run build`
- [ ] `bun run typecheck`
- [ ] `bun run test`

---

## Phase 4: Gemini Provider 적용 (P1 - Consistency)

**Status**: ⏳ Pending  
**예상 시간**: 1시간  
**위험도**: 🟢 Low

### 4.1 Gemini 스트리밍에 blockIndex 적용

**파일**: `packages/core/src/providers/gemini/streaming.ts`

- [ ] `parseStreamChunk`에서 `blockIndex = candidateIndex` 설정
- [ ] `finishReason` → `block_stop` 분리 (선택)

### 테스트
- [ ] 기존 Gemini 스트리밍 테스트 통과 확인

### Quality Gates
- [ ] `bun run build`
- [ ] `bun run typecheck`
- [ ] `bun run test`

---

## Phase 5: Hub 레벨 유틸리티 (P2 - Enhancement)

**Status**: ⏳ Pending  
**예상 시간**: 1시간  
**위험도**: 🟢 Low

### 5.1 JSON Accumulator 유틸리티 (선택)

**파일**: `packages/core/src/utils/json-accumulator.ts`

- [ ] blockIndex 기반 partialJson 누적
- [ ] 완전한 JSON 시 parsedArguments 반환
- [ ] JSON.parse 에러 시 에러 이벤트 생성

```typescript
export class JsonAccumulator {
  private buffers: Map<number, string> = new Map()
  
  accumulate(blockIndex: number, partialJson: string): { 
    complete: boolean
    parsed?: Record<string, unknown>
    error?: string
  } {
    // ...
  }
}
```

### 5.2 Block Tracker 유틸리티 (선택)

- [ ] blockIndex 기반 블록 상태 추적
- [ ] block_stop 이벤트로 블록 완료 감지

### Quality Gates
- [ ] `bun run build`
- [ ] `bun run typecheck`
- [ ] `bun run test`

---

## Phase 6: 문서화 (P3 - Finalization)

**Status**: ⏳ Pending  
**예상 시간**: 30분  
**위험도**: 🟢 Low

### 6.1 Unified Streaming Model 문서

- [ ] `docs/UNIFIED_STREAMING_MODEL.md` 생성
  - [ ] blockIndex 개념 설명
  - [ ] block_stop 이벤트 의미
  - [ ] Provider별 매핑 방식
  - [ ] ThinkingBlock.redacted 사용법

### 6.2 PLAN.md 업데이트

- [ ] 이 작업을 Phase 17로 추가

### Quality Gates
- [ ] `bun run build`
- [ ] `bun run typecheck`

---

## 변경 파일 요약

| 레벨 | 파일 | 변경 내용 | 위험도 |
|------|------|----------|--------|
| **Unified (Hub)** | `packages/core/src/types/unified.ts` | blockIndex, blockType, block_stop, redacted 추가 | 🟠 High |
| **Anthropic** | `packages/core/src/providers/anthropic/streaming.ts` | blockIndex 매핑, block_stop 처리 | 🟡 Medium |
| **Anthropic** | `packages/core/src/providers/anthropic/response.ts` | tool_result, redacted_thinking 파싱 | 🟢 Low |
| **Anthropic** | `packages/core/src/providers/anthropic/request.ts` | JSON.parse 에러 방어 | 🟢 Low |
| **OpenAI** | `packages/core/src/providers/openai/streaming.ts` | blockIndex 설정 | 🟢 Low |
| **Gemini** | `packages/core/src/providers/gemini/streaming.ts` | blockIndex 설정 | 🟢 Low |

---

## Provider 영향도 분석

| Provider | blockIndex | block_stop | tool_result | redacted | JSON 에러 |
|----------|:----------:|:----------:|:-----------:|:--------:|:---------:|
| **Anthropic** | ✅ 필수 | ✅ 필수 | ✅ 필수 | ✅ 필수 | ✅ 필수 |
| **OpenAI** | 🟡 0 고정 | 🟡 finish_reason 매핑 | N/A | N/A | 🟡 동일 적용 |
| **Gemini** | 🟡 0 고정 | 🟡 finishReason 매핑 | N/A | N/A | 🟡 동일 적용 |
| **Antigravity** | 🟡 passthrough | 🟡 passthrough | N/A | N/A | 🟡 동일 적용 |

---

## 롤백 계획

Phase별 독립 롤백 가능:
- Phase 1: Unified 타입에서 새 필드 제거 (모든 Provider 영향)
- Phase 2-4: 각 Provider 내부 변경만 원복
- Phase 5: 유틸리티 삭제

---

## Implementation Notes

_(구현 중 작성)_
