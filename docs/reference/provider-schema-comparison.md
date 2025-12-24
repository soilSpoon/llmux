# Provider Schema 비교 분석

**Created:** 2025-12-24  
**Sources:** litellm, opencode, opencode-antigravity-auth, opencode-google-antigravity-auth

---

## 1. 프로젝트별 스키마 사용 현황

| 프로젝트 | 언어 | 주요 역할 | 지원 공급사 |
|---------|------|----------|------------|
| **litellm** | Python | 100+ 공급사 통합 프록시 | OpenAI, Anthropic, Gemini, Vertex AI, Bedrock, Azure 등 |
| **opencode** | TypeScript | AI 코딩 에이전트 | Anthropic, OpenAI, Google, Mistral, Bedrock 등 |
| **opencode-antigravity-auth** | TypeScript | Antigravity 플러그인 | Claude, Gemini via Antigravity Gateway |
| **opencode-google-antigravity-auth** | TypeScript | Google Antigravity 플러그인 | Claude, Gemini via Antigravity Gateway |

---

## 2. 요청 스키마 비교

### 2.1 메시지 구조

| 항목 | OpenAI | Anthropic/Claude | Gemini | Antigravity |
|-----|--------|------------------|--------|-------------|
| **컨테이너** | `messages[]` | `messages[]` | `contents[]` | `request.contents[]` |
| **역할** | `system`, `user`, `assistant`, `tool`, `developer` | `user`, `assistant` (system 별도) | `user`, `model` | `user`, `model` |
| **내용 필드** | `content` (string 또는 array) | `content` (array of blocks) | `parts[]` | `parts[]` |

### 2.2 시스템 지시문

| 공급사 | 형식 | 예시 |
|--------|------|------|
| **OpenAI** | 첫 번째 `system` role 메시지 | `{role: "system", content: "..."}` |
| **Anthropic** | 별도 `system` 필드 | `{system: "..."}`  또는 `{system: [{type: "text", text: "..."}]}` |
| **Gemini** | `systemInstruction` 객체 | `{systemInstruction: {parts: [{text: "..."}]}}` ⚠️ 문자열 불가 |
| **Antigravity** | Gemini 스타일 | `{request: {systemInstruction: {parts: [...]}}}` |

### 2.3 Content Block/Part 타입

| 타입 | OpenAI | Anthropic | Gemini | Antigravity |
|------|--------|-----------|--------|-------------|
| **텍스트** | `{type: "text", text}` | `{type: "text", text}` | `{text: "..."}` | `{text: "..."}` |
| **이미지** | `{type: "image_url", image_url: {url}}` | `{type: "image", source: {type, data, media_type}}` | `{inlineData: {mimeType, data}}` | 동일 |
| **Tool 호출** | `tool_calls[]` in message | `{type: "tool_use", id, name, input}` | `{functionCall: {name, args, id}}` | 동일 |
| **Tool 결과** | `{role: "tool", content, tool_call_id}` | `{type: "tool_result", tool_use_id, content}` | `{functionResponse: {name, id, response}}` | 동일 |
| **Thinking** | `reasoning_content` (일부 모델) | `{type: "thinking", thinking, signature}` | `{thought: true, text, thoughtSignature}` | 동일 |

---

## 3. Tool/Function 정의 비교

### 3.1 구조

| 공급사 | 위치 | 구조 |
|--------|------|------|
| **OpenAI** | `tools[]` | `{type: "function", function: {name, description, parameters}}` |
| **Anthropic** | `tools[]` | `{name, description, input_schema}` + 내장 도구 |
| **Gemini** | `tools[].functionDeclarations[]` | `{name, description, parameters}` |
| **Antigravity** | `request.tools[]` | Gemini 스타일 |

### 3.2 스키마 지원

| JSON Schema 기능 | OpenAI | Anthropic | Gemini | Antigravity |
|-----------------|--------|-----------|--------|-------------|
| `type`, `properties` | ✅ | ✅ | ✅ | ✅ |
| `required` | ✅ | ✅ | ✅ | ✅ |
| `enum` | ✅ | ✅ | ✅ | ✅ |
| `const` | ✅ | ✅ | ❌ | ❌ → `enum: [value]` 변환 필요 |
| `$ref`, `$defs` | ✅ | ✅ | ❌ | ❌ → 인라인 필요 |
| `anyOf`, `oneOf` | ✅ | ✅ | ✅ → `any_of` | ✅ |
| `default`, `examples` | ✅ | ✅ | ❌ | ❌ → 제거 필요 |

### 3.3 Tool 이름 규칙

| 규칙 | OpenAI | Anthropic | Gemini/Antigravity |
|------|--------|-----------|-------------------|
| 첫 문자 | 유연함 | 유연함 | 문자 또는 `_` 필수 |
| 허용 문자 | 대부분 | 대부분 | `a-zA-Z0-9_.-:` |
| 금지 문자 | - | - | `/`, 공백 |
| 최대 길이 | - | - | 64자 |

---

## 4. 생성 설정 비교

| 파라미터 | OpenAI | Anthropic | Gemini | Antigravity |
|---------|--------|-----------|--------|-------------|
| **최대 토큰** | `max_tokens` | `max_tokens` (필수) | `maxOutputTokens` | `maxOutputTokens` |
| **Temperature** | `temperature` | `temperature` | `temperature` | `temperature` |
| **Top P** | `top_p` | `top_p` | `topP` | `topP` |
| **Top K** | ❌ | `top_k` | `topK` | `topK` |
| **Stop** | `stop` (array) | `stop_sequences` | `stopSequences` | `stopSequences` |
| **Thinking** | `reasoning_effort` | `thinking: {budget_tokens}` | `thinkingConfig: {thinkingBudget}` | `thinkingConfig` |

---

## 5. 응답 스키마 비교

### 5.1 최상위 구조

| 공급사 | 구조 |
|--------|------|
| **OpenAI** | `{id, object, choices[], usage}` |
| **Anthropic** | `{id, type: "message", role, content[], stop_reason, usage}` |
| **Gemini** | `{candidates[], usageMetadata, modelVersion, responseId}` |
| **Antigravity** | `{response: {candidates[], ...}, traceId}` → 플러그인이 `response`만 추출 |

### 5.2 완료 이유

| 이유 | OpenAI | Anthropic | Gemini |
|-----|--------|-----------|--------|
| 정상 종료 | `stop` | `end_turn` | `STOP` |
| 토큰 한도 | `length` | `max_tokens` | `MAX_TOKENS` |
| Tool 사용 | `tool_calls` | `tool_use` | `OTHER` |
| 안전 필터 | `content_filter` | - | `SAFETY` |

### 5.3 Usage 필드

| 필드 | OpenAI | Anthropic | Gemini |
|------|--------|-----------|--------|
| 입력 토큰 | `prompt_tokens` | `input_tokens` | `promptTokenCount` |
| 출력 토큰 | `completion_tokens` | `output_tokens` | `candidatesTokenCount` |
| Thinking 토큰 | - | (usage에 포함) | `thoughtsTokenCount` |
| 캐시 토큰 | `cached_tokens` | `cache_creation_input_tokens`, `cache_read_input_tokens` | `cachedContentTokenCount` |

---

## 6. 스트리밍 형식 비교

### 6.1 이벤트 타입

| 공급사 | 형식 | 이벤트 |
|--------|------|--------|
| **OpenAI** | SSE | `data: {choices: [{delta: {...}}]}` |
| **Anthropic** | SSE | `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` |
| **Gemini** | SSE | `data: {candidates: [...], usageMetadata: {...}}` |
| **Antigravity** | SSE | `data: {response: {...}}` → 플러그인이 unwrap |

### 6.2 Delta 구조

```jsonc
// OpenAI
{"choices": [{"delta": {"content": "Hello"}}]}
{"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "..."}}]}}]}

// Anthropic
{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}
{"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": "..."}}

// Gemini
{"candidates": [{"content": {"parts": [{"text": "Hello"}]}}]}
{"candidates": [{"content": {"parts": [{"functionCall": {...}}]}}]}
```

---

## 7. Thinking/Reasoning 처리 비교

### 7.1 요청 설정

| 공급사 | 활성화 방법 | 파라미터 |
|--------|------------|---------|
| **OpenAI** | `reasoning_effort` | `"low"`, `"medium"`, `"high"` |
| **Anthropic** | `thinking` 객체 | `{type: "enabled", budget_tokens: N}` |
| **Gemini** | `thinkingConfig` | `{thinkingBudget: N, includeThoughts: true}` 또는 `{thinkingLevel: "high"}` |
| **Antigravity (Claude)** | `thinkingConfig` | `{include_thoughts: true, thinking_budget: N}` (snake_case) |

### 7.2 응답 형식

| 공급사 | Thinking 블록 구조 |
|--------|-------------------|
| **OpenAI** | `reasoning_content` 필드 (일부 모델) |
| **Anthropic** | `{type: "thinking", thinking: "...", signature: "..."}` |
| **Gemini** | `{thought: true, text: "...", thoughtSignature: "..."}` |

### 7.3 시그니처 처리 (멀티턴)

| 항목 | 설명 |
|------|------|
| **문제** | Claude는 멀티턴에서 서명되지 않은 thinking 블록 거부 |
| **해결** | 플러그인이 시그니처를 캐시하여 후속 요청에 복원 |
| **캐시 키** | `hash(sessionId + model + text)` |
| **TTL** | 1시간, 세션당 최대 100개 |

---

## 8. 프로젝트별 변환 패턴

### 8.1 litellm (Python)

```python
class BaseConfig(ABC):
    def get_supported_openai_params(model: str) -> list
    def map_openai_params(params, model) -> dict  # OpenAI → Provider
    def transform_request(model, messages, params) -> dict
    def transform_response(raw_response, model_response) -> ModelResponse
```

**특징:**
- OpenAI 형식을 "표준"으로 사용
- 각 공급사별 Config 클래스가 변환 담당
- Usage를 OpenAI 스타일로 통합

### 8.2 opencode (TypeScript)

```typescript
namespace ProviderTransform {
  message(model, messages): ModelMessage[]  // ID 정규화, 미지원 파트 처리
  options(model): LanguageModelV1CallOptions  // 공급사별 옵션
  schema(model, schema): JSONSchema  // enum 정규화
  applyCaching(model, messages): ModelMessage[]  // 캐시 제어
}
```

**특징:**
- AI SDK의 `LanguageModelV2` 인터페이스 사용
- 공급사별 quirk를 미리 정규화
- `reasoning` 파트를 `reasoning_content`로 이동

### 8.3 opencode-antigravity-auth (TypeScript)

```typescript
prepareAntigravityRequest(url, body, headers)
  → {url, body: {project, model, request, ...}, headers}

transformAntigravityResponse(response, streaming)
  → unwrapped response, cached signatures
```

**특징:**
- Gemini 스타일 API를 Antigravity wrapper로 감쌈
- Claude 모델은 `toolConfig.mode = "VALIDATED"` 강제
- Thinking 시그니처 캐싱/복원

### 8.4 opencode-google-antigravity-auth (TypeScript)

```typescript
transformClaudeRequest(context, body)
  → Claude 전용 변환 (snake_case thinkingConfig, schema 정규화)

transformGeminiRequest(context, body)
  → Gemini 전용 변환 (시스템 힌트 주입, 도구 이름 정제)
```

**특징:**
- 모델 패밀리별 분기 (`isClaudeModel`)
- 도구 스키마 캐싱 및 응답 정규화
- 대화 이력에서 artifact 제거

---

## 9. 테스트 전략

### 9.1 단위 테스트 (변환 함수)

| 테스트 대상 | 검증 항목 |
|------------|----------|
| **메시지 변환** | role 매핑, content 구조 변환 |
| **시스템 지시문** | 문자열 → 객체 변환 |
| **Tool 스키마** | `const` → `enum`, `$ref` 인라인화 |
| **Thinking 설정** | 예산/한도 자동 조정 |

```go
// 예시: Go 단위 테스트
func TestOpenAIToGeminiMessages(t *testing.T) {
    input := OpenAIRequest{
        Messages: []Message{{Role: "assistant", Content: "Hello"}},
    }
    expected := GeminiRequest{
        Contents: []Content{{Role: "model", Parts: []Part{{Text: "Hello"}}}},
    }
    result := TransformOpenAIToGemini(input)
    assert.Equal(t, expected, result)
}
```

### 9.2 통합 테스트 (Mock 서버)

```go
// 예시: Mock 서버로 왕복 테스트
func TestRoundTrip(t *testing.T) {
    // 1. OpenAI 형식 요청 생성
    openaiReq := createTestOpenAIRequest()
    
    // 2. Gemini로 변환
    geminiReq := Transform(openaiReq, "gemini")
    
    // 3. Mock Gemini 서버로 전송
    geminiResp := mockGeminiServer.Handle(geminiReq)
    
    // 4. OpenAI로 역변환
    openaiResp := TransformResponse(geminiResp, "openai")
    
    // 5. 검증
    assert.NotEmpty(t, openaiResp.Choices)
}
```

### 9.3 스트리밍 테스트

```go
func TestStreamingTransform(t *testing.T) {
    // SSE 청크 시퀀스
    chunks := []string{
        `data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}`,
        `data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}`,
    }
    
    var result strings.Builder
    for _, chunk := range chunks {
        transformed := TransformStreamChunk(chunk, "openai")
        // {"choices":[{"delta":{"content":"Hel"}}]}
        result.WriteString(extractContent(transformed))
    }
    
    assert.Equal(t, "Hello", result.String())
}
```

### 9.4 Thinking 시그니처 테스트

```go
func TestThinkingSignatureCache(t *testing.T) {
    // 1. 첫 요청: thinking 블록 + 시그니처 응답
    resp1 := simulateResponse(withThinking("Let me think...", "sig123"))
    CacheSignatures(resp1)
    
    // 2. 두 번째 요청: 시그니처 없는 thinking 블록
    req2 := createRequest(withThinking("Let me think...", ""))
    restored := RestoreSignatures(req2)
    
    // 3. 시그니처가 복원되었는지 확인
    assert.Equal(t, "sig123", restored.ThinkingSignature)
}
```

### 9.5 실제 API 테스트 (E2E)

```bash
# 환경 변수 설정
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...

# 프록시 서버 시작
go run ./cmd/server

# curl로 변환 테스트
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Target-Provider: gemini" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## 10. 관련 문서

- [openai-chat-completions-schema.md](./openai-chat-completions-schema.md)
- [anthropic-api-schema.md](./anthropic-api-schema.md)
- [gemini-api-schema.md](../schemas/gemini-api-schema.md)
- [antigravity-api-schema.md](./antigravity-api-schema.md)
- [ANTIGRAVITY_API_SPEC.md](../../opencode-antigravity-auth/docs/ANTIGRAVITY_API_SPEC.md)
- [CLAUDE_MODEL_FLOW.md](../../opencode-antigravity-auth/docs/CLAUDE_MODEL_FLOW.md)
