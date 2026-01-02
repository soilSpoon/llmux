# Thinking Signature Fallback 처리 구현 계획

## 개요
Cross-model fallback 시 `thoughtSignature` 검증 오류를 방지하기 위한 signature 제거/변환 로직 구현

**Status**: ⏳ Pending  
**Last Updated**: 2025-12-31  
**Risk Level**: 🟡 Medium

## 문제 정의

### 현상
```
{
  "error": {
    "code": 400,
    "message": "Corrupted thought signature.",
    "status": "INVALID_ARGUMENT"
  }
}
```

### 원인
1. `claude-opus-4-5-thinking` 모델이 429 rate limit 발생
2. `gemini-3-pro-preview`로 fallback 시도
3. 이전 대화의 `thoughtSignature`가 포함된 상태로 Gemini에 전송
4. Gemini가 Claude의 signature를 검증 시도 → 실패

### 검증 결과 (test-thinking-signature.ts)
| 방식 | 결과 |
|------|------|
| `thoughtSignature` 포함 | ❌ `Corrupted thought signature.` |
| `thoughtSignature`만 제거 | ✅ 성공 |
| thinking → text 변환 | ✅ 성공 |

## 해결 방안
Fallback 시 `thoughtSignature` 필드만 제거하고 `thought: true` + `text`는 유지

```typescript
// parts에서 thoughtSignature만 제거
parts = parts.map(p => {
  if (p.thoughtSignature) {
    const { thoughtSignature, ...rest } = p
    return rest  // { thought: true, text: "..." } 유지
  }
  return p
})
```

---

## Phase 1: Core 타입 및 유틸리티 함수
⏳ Pending | Est: 30min | Risk: 🟢 Low

### 테스트 먼저 작성
- [ ] `packages/core/test/utils/signature-strip.test.ts` 생성
  - [ ] `stripThoughtSignatures` 기본 동작 테스트
  - [ ] thinking 블록에서 signature만 제거 확인
  - [ ] thought: true와 text 유지 확인
  - [ ] signature 없는 parts는 변경 없음 확인
  - [ ] 빈 배열 처리 테스트
  - [ ] nested contents 배열 처리 테스트

### 구현
- [ ] `packages/core/src/utils/signature-strip.ts` 생성
  ```typescript
  import type { GeminiPart } from '../providers/gemini/types'
  
  /**
   * Remove thoughtSignature from parts for cross-model fallback
   * Preserves thought: true and text content
   */
  export function stripThoughtSignatures<T extends { thoughtSignature?: string }>(
    parts: T[]
  ): T[] {
    return parts.map(part => {
      if (part.thoughtSignature) {
        const { thoughtSignature, ...rest } = part
        return rest as T
      }
      return part
    })
  }
  
  /**
   * Strip signatures from entire contents array (Gemini/Antigravity format)
   */
  export function stripSignaturesFromContents(
    contents: Array<{ role: string; parts: Array<{ thoughtSignature?: string }> }>
  ): typeof contents {
    return contents.map(content => ({
      ...content,
      parts: stripThoughtSignatures(content.parts)
    }))
  }
  ```

- [ ] `packages/core/src/utils/index.ts`에 export 추가

### Quality Gate
```bash
bun test packages/core/test/utils/signature-strip.test.ts
bun run typecheck
```

---

## Phase 2: Antigravity Provider 통합
⏳ Pending | Est: 45min | Risk: 🟡 Medium

### 테스트 먼저 작성
- [ ] `packages/core/test/providers/antigravity/request.test.ts`에 테스트 추가
  - [ ] `transform()` 호출 시 `stripSignatures: true` 옵션 테스트
  - [ ] signature 제거 후 contents 형식 유지 확인
  - [ ] model이 다를 때만 signature 제거 옵션 활성화 테스트

### 구현
- [ ] `packages/core/src/providers/antigravity/request.ts` 수정
  - [ ] `TransformOptions` 인터페이스에 `stripSignatures?: boolean` 추가
  - [ ] `transform()` 함수에서 옵션 처리

### Quality Gate
```bash
bun test packages/core/test/providers/antigravity/
bun run typecheck
```

---

## Phase 3: Server Streaming Handler 통합
⏳ Pending | Est: 45min | Risk: 🟡 Medium

### 테스트 먼저 작성
- [ ] `packages/server/test/handlers/streaming-fallback.test.ts` 생성
  - [ ] 429 fallback 시 signature 제거 확인
  - [ ] 같은 모델로 재시도 시 signature 유지 확인
  - [ ] 다른 모델로 fallback 시 signature 제거 확인
  - [ ] thinking 내용(text) 보존 확인

### 구현
- [ ] `packages/server/src/handlers/streaming.ts` 수정
  - [ ] fallback 로직에서 model 변경 감지
  - [ ] model이 다르면 `stripSignaturesFromContents` 호출
  - [ ] 로그에 signature 제거 여부 기록

### Quality Gate
```bash
bun test packages/server/test/handlers/streaming-fallback.test.ts
bun run typecheck
```

---

## Phase 4: 통합 테스트 및 E2E 검증
⏳ Pending | Est: 30min | Risk: 🟢 Low

### 테스트 작성
- [ ] `packages/server/test/integration/signature-fallback.test.ts` 생성
  - [ ] Claude → Gemini fallback 시나리오 통합 테스트
  - [ ] signature 있는 대화 히스토리로 fallback 테스트
  - [ ] 응답 성공 확인

### E2E 스크립트 업데이트
- [ ] `examples/test-thinking-signature.ts` 완성
  - [ ] llmux 서버를 통한 실제 fallback 시나리오 테스트
  - [ ] 429 시뮬레이션 또는 실제 rate limit 테스트

### Quality Gate
```bash
bun run build
bun run test
bun run typecheck
```

---

## 변환 로직 상세

### Before (문제 상황)
```json
{
  "contents": [
    {
      "role": "model",
      "parts": [
        {
          "thought": true,
          "text": "Let me think...",
          "thoughtSignature": "ErADCq0DAXLI2nx..."  // ❌ Claude 서명
        },
        {
          "text": "The answer is 4"
        }
      ]
    }
  ]
}
```

### After (해결)
```json
{
  "contents": [
    {
      "role": "model",
      "parts": [
        {
          "thought": true,
          "text": "Let me think..."  // ✅ 서명 제거, 내용 유지
        },
        {
          "text": "The answer is 4"
        }
      ]
    }
  ]
}
```

---

## 영향 범위

### 수정 파일
| 패키지 | 파일 | 변경 내용 |
|--------|------|----------|
| @llmux/core | `src/utils/signature-strip.ts` | 새 파일 (유틸리티) |
| @llmux/core | `src/utils/index.ts` | export 추가 |
| @llmux/core | `src/providers/antigravity/request.ts` | stripSignatures 옵션 |
| @llmux/server | `src/handlers/streaming.ts` | fallback 시 signature 제거 |

### 테스트 파일
| 패키지 | 파일 |
|--------|------|
| @llmux/core | `test/utils/signature-strip.test.ts` |
| @llmux/core | `test/providers/antigravity/request.test.ts` (추가) |
| @llmux/server | `test/handlers/streaming-fallback.test.ts` |
| @llmux/server | `test/integration/signature-fallback.test.ts` |

---

## Notes
<!-- Implementation notes will be added here during execution -->
