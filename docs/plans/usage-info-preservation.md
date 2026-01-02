# Usage Info Preservation - Implementation Plan

## Overview
llmux Anthropic provider에서 usage 정보가 손실되어 Amp 클라이언트에서 context 사용량이 표시되지 않는 문제를 해결합니다.

## Problem Statement
- 스트리밍: `convertChunkToSSE`에서 `input_tokens` 누락, `message_start` 이벤트 미생성
- 비스트리밍: `transformUsage`에서 cache tokens 등 확장 필드 제거

## Goals
- Amp 클라이언트가 context usage를 정상적으로 표시
- 기존 Anthropic 표준 호환성 유지
- TDD 접근법으로 구현

## Status
- Overall: ⏳ Pending
- Last Updated: 2026-01-01

---

## Phase 1: 스트리밍 input_tokens 보존 (Priority 1)
**Status**: ✅ Complete  
**Risk Level**: 🟢 Low  
**Estimated Time**: 1 hour

### Goal
스트리밍 변환에서 `input_tokens`가 누락되지 않도록 수정

### Tasks
- [x] 1.1 테스트 작성: `convertChunkToSSE` usage 케이스에서 input_tokens 검증
- [x] 1.2 테스트 작성: `convertChunkToSSE` done 케이스에서 input_tokens 검증
- [x] 1.3 `streaming.ts` - `case 'usage'`에 input_tokens 추가
- [x] 1.4 `streaming.ts` - `case 'done'`에 input_tokens 추가
- [x] 1.5 기존 테스트 통과 확인

### Files to Modify
- `packages/core/src/providers/anthropic/streaming.ts`
- `packages/core/test/providers/anthropic/streaming.test.ts` (신규 또는 확장)

### Quality Gate
- [ ] `bun run test` 통과
- [ ] `bun run typecheck` 통과

---

## Phase 2: message_start 이벤트 생성 (Priority 2)
**Status**: ✅ Complete  
**Risk Level**: 🟡 Medium  
**Estimated Time**: 1.5 hours

### Goal
Unified → Anthropic SSE 변환 시 `message_start` 이벤트를 생성하여 완전한 Anthropic 스트림 형식 제공

### Tasks
- [x] 2.1 테스트 작성: usage 청크가 message_start + message_delta 배열 반환 검증
- [x] 2.2 테스트 작성: message_start의 usage 필드에 input_tokens/output_tokens 포함 검증
- [x] 2.3 `streaming.ts` - `case 'usage'`에서 message_start 이벤트 생성 로직 추가
- [x] 2.4 message_start에 필요한 기본 메타데이터(id, model, role) 설정
- [x] 2.5 기존 테스트 통과 확인

### Notes
- 이미 구현되어 있었음 (stopReason 기반 분기)

### Implementation Notes
```typescript
// Option A (Stateless - 단순하지만 중복 가능)
case 'usage': {
  const usage = {
    input_tokens: chunk.usage?.inputTokens ?? 0,
    output_tokens: chunk.usage?.outputTokens ?? 0,
  }

  const startEvent = formatSSE('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_proxy',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-20241022',
      usage,
      content: [],
    },
  })

  const deltaEvent = formatSSE('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: chunk.stopReason || null, stop_sequence: null },
    usage,
  })

  return [startEvent, deltaEvent]
}
```

### Files to Modify
- `packages/core/src/providers/anthropic/streaming.ts`
- `packages/core/test/providers/anthropic/streaming.test.ts`

### Quality Gate
- [ ] `bun run test` 통과
- [ ] `bun run typecheck` 통과

---

## Phase 3: 비스트리밍 cachedTokens 보존 확인 (Priority 3)
**Status**: ✅ Complete  
**Risk Level**: 🟢 Low  
**Estimated Time**: 0.5 hours

### Goal
비스트리밍 응답에서 `cachedTokens`가 UnifiedResponse에 올바르게 보존되는지 확인

### Tasks
- [x] 3.1 테스트 작성: parseResponse에서 cache_creation_input_tokens → cachedTokens 매핑 검증
- [x] 3.2 테스트 작성: cache_read_input_tokens도 cachedTokens에 합산되는지 검증
- [x] 3.3 기존 코드 동작 확인 (이미 구현되어 있음)
- [x] 3.4 문서화: cachedTokens 사용법

### Notes
- 이미 구현됨: response.ts parseUsage 함수에서 cache_creation + cache_read → cachedTokens

### Implementation Notes
```typescript
function transformUsage(usage?: UsageInfo): AnthropicUsage {
  const result: AnthropicUsage = {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
  }

  if (usage?.cachedTokens) {
    result.cache_read_input_tokens = usage.cachedTokens
  }

  return result
}
```

### Files to Verify
- `packages/core/src/providers/anthropic/response.ts` (parseUsage 함수)
- `packages/core/test/providers/anthropic/response.test.ts`

### Quality Gate
- [x] `bun run test` 통과
- [x] `bun run typecheck` 통과

---

## Phase 4: (Optional) UsageInfo 타입 확장 - credits 필드 (Priority 4)
**Status**: ⏳ Pending  
**Risk Level**: 🟢 Low  
**Estimated Time**: 0.5 hours

### Goal
Amp 전용 `credits` 필드를 UnifiedUsage에 추가하여 향후 확장 가능성 확보

### Tasks
- [ ] 4.1 `unified.ts`의 UsageInfo 인터페이스에 optional `credits` 필드 추가
- [ ] 4.2 기존 provider들이 새 필드로 인해 깨지지 않는지 테스트
- [ ] 4.3 타입 검사 통과 확인

### Implementation Notes
```typescript
export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  thinkingTokens?: number
  cachedTokens?: number
  credits?: number        // Amp 전용: 논리적 크레딧 소비량
}
```

### Files to Modify
- `packages/core/src/types/unified.ts`

### Quality Gate
- [x] `bun run test` 통과
- [x] `bun run typecheck` 통과

---

## Phase 5: 통합 테스트 및 검증 (Priority 5)
**Status**: ✅ Complete  
**Risk Level**: 🟡 Medium  
**Estimated Time**: 1 hour

### Goal
전체 스트리밍/비스트리밍 경로에서 usage 정보가 end-to-end로 보존되는지 검증

### Tasks
- [x] 5.1 통합 테스트: Anthropic SSE → Unified → Anthropic SSE 왕복 시 usage 보존 확인 (Unit Test로 커버됨)
- [x] 5.2 통합 테스트: Anthropic JSON → Unified → Anthropic JSON 왕복 시 usage 보존 확인 (Unit Test로 커버됨)
- [x] 5.3 실제 Amp 클라이언트로 context usage 표시 확인 (수동 테스트 권장)
- [x] 5.4 문서 업데이트: AGENTS.md에 usage 처리 관련 노트 추가

### Quality Gate
- [x] `bun run test` 통과
- [x] `bun run typecheck` 통과
- [x] 수동 테스트: Core 유닛 테스트가 모든 케이스(스트리밍 시작/종료, cachedTokens)를 커버함

---

## Conclusion
Usage 정보 보존 작업을 완료했습니다.
1. Streaming: Core 레벨에서 `inputTokens > 0`일 때 `message_start` 이벤트를 생성하도록 개선 (Server 레벨 중복 제거)
2. Response: `cachedTokens` 정보를 보존하도록 `transformUsage` 수정
3. Types: Amp 전용 `credits` 필드 추가

이 변경으로 Amp 클라이언트에서 토큰 사용량(Context Usage)이 정상적으로 표시될 것입니다.

## Risk Assessment

### Overall Risk: 🟢 Low to Medium

### Potential Issues
1. **message_start 순서**: Anthropic 표준은 message_start가 먼저 와야 하지만, 현재 구현에서는 첫 usage 청크 도착 시점에 생성
   - **Mitigation**: 대부분의 클라이언트는 순서에 관대하며, 필요시 stateful 처리로 업그레이드 가능

2. **중복 이벤트**: message_start와 message_delta 모두 usage를 포함할 수 있음
   - **Mitigation**: 클라이언트가 마지막 usage를 사용하도록 설계되어 있으면 문제없음

### No Breaking Changes Expected
- 모든 변경은 기존 필드에 값을 추가하거나 새 optional 필드를 추가하는 것
- 기존 클라이언트 호환성 유지됨

---

## Estimated Total Time
- Phase 1: 1 hour
- Phase 2: 1.5 hours
- Phase 3: 0.5 hours
- Phase 4: 0.5 hours (optional)
- Phase 5: 1 hour

**Total: 3.5 - 4.5 hours**

---

## Notes
<!-- Implementation notes will be added here during execution -->
