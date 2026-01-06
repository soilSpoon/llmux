# Google Gemini Schema (`google-gemini`)

**Endpoint**: `/v1/models/{model}:generateContent` (or `:streamGenerateContent`)
**SDK Reference**: `@ai-sdk/google`

## Request Schema

```typescript
interface GeminiRequest {
  contents: GeminiContent[]
  systemInstruction?: { parts: Array<{ text: string }> }
  tools?: Array<{
    functionDeclarations: Array<{
      name: string
      description: string
      parameters: JSONSchema
    }>
  }>
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'NONE' | 'ANY'
      allowedFunctionNames?: string[]
    }
  }
  generationConfig?: {
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    candidateCount?: number
    stopSequences?: string[]
    responseMimeType?: string
    responseSchema?: JSONSchema
  }
  safetySettings?: Array<{
    category: string
    threshold: string
  }>
}

interface GeminiContent {
  role: 'user' | 'model'  // NOT 'assistant'!
  parts: GeminiPart[]
}

type GeminiPart =
  | { text: string }
  | { text: string, thought: true, thoughtSignature?: string }  // Thinking
  | { inlineData: { mimeType: string, data: string } }  // Base64 image
  | { fileData: { mimeType: string, fileUri: string } }  // Cloud file
  | { functionCall: { name: string, args: unknown } }
  | { functionCall: { name: string, args: unknown }, thoughtSignature?: string }  // After thinking
  | { functionResponse: { name: string, response: unknown } }
```

## Response Schema

```typescript
interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | 'BLOCKLIST' | 'PROHIBITED_CONTENT' | 'SPII' | null
    safetyRatings?: Array<{ category: string, probability: string, blocked?: boolean }>
    citationMetadata?: { citationSources: Array<{ startIndex: number, endIndex: number, uri?: string }> }
    groundingMetadata?: { ... }
    index?: number
  }>
  promptFeedback?: {
    blockReason?: string
    safetyRatings?: Array<{ category: string, probability: string }>
  }
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
    cachedContentTokenCount?: number
    thoughtsTokenCount?: number
  }
}
```

## Streaming Response

```typescript
// Same structure as non-streaming, sent as multiple JSON objects
// Each chunk contains partial candidates[].content.parts
interface GeminiStreamChunk {
  candidates: Array<{
    content: GeminiContent  // Incremental parts
    finishReason?: string   // Only in final chunk
  }>
  usageMetadata?: { ... }   // Only in final chunk
}
```

## Key Transformation Notes

### Parse (Wire → Unified)
| Wire Field | Unified Field | Notes |
|------------|---------------|-------|
| `systemInstruction.parts` | `system` | Join all text parts |
| `contents[role='model']` | `role: 'assistant'` | **Role name differs** |
| `parts[].text` | `parts: [{ type: 'text', text }]` | Wrap with type |
| `parts[].text` + `thought: true` | `parts: [{ type: 'thinking', ... }]` | Check `thought` flag |
| `parts[].inlineData` | `parts: [{ type: 'image', mimeType, data }]` | Extract from object |
| `parts[].functionCall` | `parts: [{ type: 'tool_call', ... }]` | Map `args` → `arguments` |
| `parts[].functionResponse` | `parts: [{ type: 'tool_result', ... }]` | Map `name` + `response` |
| `finishReason: 'STOP'` | `stopReason: 'end_turn'` | Normalize values |
| `finishReason: 'MAX_TOKENS'` | `stopReason: 'max_tokens'` | Direct map |
| `thoughtSignature` | `thoughtSignature` | Preserve on tool_call after thinking |

### Build (Unified → Wire)
| Unified Field | Wire Field | Notes |
|---------------|------------|-------|
| `system` | `systemInstruction: { parts: [{ text }] }` | Wrap structure |
| `role: 'assistant'` | `role: 'model'` | **Role name differs** |
| `parts[type='text']` | `{ text }` | Unwrap type |
| `parts[type='thinking']` | `{ text, thought: true, thoughtSignature }` | Add `thought` flag |
| `parts[type='image']` | `{ inlineData: { mimeType, data } }` | Wrap in object |
| `parts[type='image']` (url) | `{ fileData: { mimeType, fileUri } }` | If URL, use fileData |
| `toolCall.arguments` | `functionCall.args` | Keep as object |
| `toolResult` | `functionResponse: { name, response }` | Need to include function name |
| `tools` | `tools: [{ functionDeclarations: [...] }]` | Wrap in array + object |

## Critical Differences from OpenAI/Anthropic

| Aspect | OpenAI/Anthropic | Gemini |
|--------|------------------|--------|
| Assistant role | `assistant` | `model` |
| Message container | `messages` | `contents` |
| System prompt | In messages or separate | `systemInstruction` field |
| Content structure | `{ type, text/... }` | `{ text }` or `{ inlineData }` (no type field for text) |
| Tool definitions | `tools[]` with `function` | `tools[].functionDeclarations[]` |
| Tool call | `tool_calls[]` / `tool_use` | `functionCall` in parts |
| Tool result | `{ role: 'tool' }` / `tool_result` | `functionResponse` in parts |
| Tool arguments field | `arguments` | `args` |
| Thinking indicator | Separate block type | `thought: true` flag on text part |
| Image data | Various formats | `inlineData` or `fileData` |
| Streaming | Delta-based / Events | Full candidate objects |
| Response structure | `choices[]` / `content[]` | `candidates[].content` |
| Usage field names | `prompt_tokens` | `promptTokenCount` (camelCase) |

## Edge Cases

1. **Role mapping**: `assistant` ↔ `model` - easy to forget
2. **Text parts have no type**: `{ text }` not `{ type: 'text', text }` - must infer
3. **Tool call vs thinking+tool**: After thinking, `functionCall` may have `thoughtSignature`
4. **Function response needs name**: Unlike Anthropic `tool_result`, Gemini `functionResponse` requires `name`
5. **Tools array wrapping**: `tools` contains `functionDeclarations` array, one extra nesting level
6. **Streaming full objects**: Each chunk is complete candidate, not delta - different merge strategy
7. **Safety blocking**: May return `promptFeedback.blockReason` instead of candidates - handle as error
8. **File URIs**: `fileData.fileUri` for cloud-stored files - may not have direct URL equivalent
9. **Thinking detection**: Check for `thought: true` property, not separate content type
10. **Usage field casing**: camelCase (`promptTokenCount`) not snake_case (`prompt_tokens`)
