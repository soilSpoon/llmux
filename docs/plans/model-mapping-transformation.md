# Model Mapping Transformation 구현 계획

## Overview
- **Feature**: Amp 요청의 model ID를 설정된 매핑에 따라 실제로 변환
- **Goal**: `amp.modelMappings`의 `from` → `to` 매핑을 proxy 요청 시 적용
- **Approach**: TDD (Test-Driven Development)

## Status
- **Overall Progress**: 🔄 In Progress (Phase 3 Complete)
- **Last Updated**: 2025-12-26
- **Current Phase**: Phase 4 (Optional)

## Use Case
```
Amp 요청: POST /v1/chat/completions
  body: { "model": "claude-opus-4-5-20251101", ... }
      ↓
llmux proxy 변환 (modelMappings 적용)
      ↓  
실제 요청: { "model": "gemini-claude-opus-4-5-thinking", ... }
```

## Architecture

### 현재 구조
```
handleProxy/handleStreamingProxy
    ↓
transformRequest (model 변환 없음)
    ↓
upstream 요청
```

### 목표 구조
```
handleProxy/handleStreamingProxy
    ↓
applyModelMapping(model, mappings) ← NEW
    ↓
transformRequest
    ↓
upstream 요청
```

---

## Phase 1: Model Mapping Utility 함수 (TDD)
**Status**: ✅ Complete  
**Estimated Time**: 1 hour  
**Risk Level**: 🟢 Low

### Tasks
- [x] 1.1 테스트 파일 생성: `handlers/__tests__/model-mapping.test.ts`
- [x] 1.2 테스트 케이스 작성 (Red)
  - [x] 단일 매핑: `from` → `to` (string)
  - [x] 배열 매핑: `from` → `to[0]` (첫 번째 사용)
  - [x] 매핑 없음: 원본 model 반환
  - [x] 빈 mappings 배열: 원본 model 반환
  - [x] undefined mappings: 원본 model 반환 (추가)
- [x] 1.3 `applyModelMapping` 함수 구현 (Green)
- [x] 1.4 리팩토링 (Refactor)

### Quality Gate
- [x] `bun test model-mapping.test.ts` 통과 (7 tests)
- [x] `pnpm build` 성공

---

## Phase 2: Proxy Handler 통합
**Status**: ✅ Complete  
**Estimated Time**: 1.5 hours  
**Risk Level**: 🟡 Medium

### Tasks
- [x] 2.1 `ProxyHandlerOptions` 인터페이스에 `modelMappings` 추가
- [x] 2.2 `handleProxy` 테스트 추가: 매핑 적용 확인
- [x] 2.3 `handleProxy`에서 `applyModelMapping` 호출
- [x] 2.4 `handleStreamingProxy` 테스트 추가
- [x] 2.5 `handleStreamingProxy`에서 `applyModelMapping` 호출

### Quality Gate
- [x] `bun test proxy.test.ts` 통과
- [x] `bun test streaming.test.ts` 통과
- [x] `pnpm build` 성공

---

## Phase 3: Server 라우팅 통합
**Status**: ✅ Complete  
**Estimated Time**: 1 hour  
**Risk Level**: 🟡 Medium

### Tasks
- [x] 3.1 `createDefaultRoutes`에 modelMappings를 proxy 핸들러에 전달
- [x] 3.2 서버 통합 테스트 추가
- [x] 3.3 E2E 테스트: config → server → handler 흐름 확인

### Quality Gate
- [x] `bun test server.test.ts` 통과
- [x] `pnpm build` 성공

---

## Phase 4: Fallback Chain 지원 (Optional)
**Status**: ⏳ Pending  
**Estimated Time**: 1 hour  
**Risk Level**: 🟠 High

### Tasks
- [ ] 4.1 첫 번째 `to` 모델 실패 시 다음 모델로 fallback
- [ ] 4.2 429/503 에러 감지 및 재시도 로직
- [ ] 4.3 테스트: fallback chain 동작 확인

### Quality Gate
- [ ] 모든 테스트 통과
- [ ] `pnpm build` 성공

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `handlers/__tests__/model-mapping.test.ts` | 매핑 유틸리티 테스트 |
| `handlers/model-mapping.ts` | `applyModelMapping` 함수 |

### Modified Files
| File | Changes |
|------|---------|
| `handlers/proxy.ts` | modelMappings 옵션 및 적용 |
| `handlers/streaming.ts` | modelMappings 옵션 및 적용 |
| `server.ts` | proxy 핸들러에 mappings 전달 |

---

## Test Strategy

### Unit Tests
```typescript
// model-mapping.test.ts
describe('applyModelMapping', () => {
  it('maps model when mapping exists', () => {
    const mappings = [{ from: 'gpt-4', to: 'custom-gpt-4' }]
    expect(applyModelMapping('gpt-4', mappings)).toBe('custom-gpt-4')
  })

  it('uses first element when to is array', () => {
    const mappings = [{ from: 'claude', to: ['model-a', 'model-b'] }]
    expect(applyModelMapping('claude', mappings)).toBe('model-a')
  })

  it('returns original when no mapping found', () => {
    const mappings = [{ from: 'other', to: 'mapped' }]
    expect(applyModelMapping('gpt-4', mappings)).toBe('gpt-4')
  })
})
```

### Integration Tests
```typescript
// proxy.test.ts
describe('handleProxy with modelMappings', () => {
  it('transforms model in request body', async () => {
    const request = createRequest({ model: 'claude-opus' })
    const mappings = [{ from: 'claude-opus', to: 'gemini-claude' }]
    
    await handleProxy(request, { modelMappings: mappings, ... })
    
    // Verify upstream received model: 'gemini-claude'
  })
})
```

---

## Notes
<!-- Implementation notes will be added here -->
