# Quickstart: Provider Schema Refactor

A quick guide to implementing and using the new schema format system.

## Overview

The new architecture separates **Provider Identity** from **Schema/Wire Format**:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Wire       │     │  Unified    │     │  Wire       │
│  Request    │ ──► │  Request    │ ──► │  Request    │
│  (OpenAI)   │     │  (Internal) │     │  (Anthropic)│
└─────────────┘     └─────────────┘     └─────────────┘
     parse()                              build()
```

## Quick Examples

### 1. Using a Format Directly

```typescript
import { OpenAIChatFormat } from '@llmux/core/formats'

// Parse incoming request
const wireRequest = {
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }]
}
const unified = OpenAIChatFormat.parseRequest(wireRequest)

// Build outgoing request (maybe to different provider)
const anthropicWire = AnthropicMessagesFormat.buildWireRequest(unified, {
  provider: 'anthropic',
  model: 'claude-3-opus'
})
```

### 2. Using Provider with Format Delegation

```typescript
import { OpenAIProvider } from '@llmux/core/providers'

const provider = new OpenAIProvider({ apiKey: '...' })

// Provider automatically uses correct format
const format = provider.getFormatForModel('gpt-4')
console.log(format.id) // 'openai-chat'
```

### 3. Multi-Format Provider

```typescript
import { OpenCodeZenProvider } from '@llmux/core/providers'

const provider = new OpenCodeZenProvider({ apiKey: '...' })

// Routes to different formats based on model
provider.getFormatForModel('gpt-4')      // → OpenAIChatFormat
provider.getFormatForModel('claude-3')   // → AnthropicMessagesFormat
provider.getFormatForModel('gemini-2')   // → GoogleGeminiFormat
```

## Implementing a New Format

```typescript
import type { SchemaFormat, UnifiedRequest, UnifiedResponse, FormatContext } from '@llmux/core/formats'

export const MyCustomFormat: SchemaFormat = {
  id: 'my-custom',

  isSupportedWireRequest(req: unknown): boolean {
    // Detect if this format can handle the request
    return req?.myCustomField !== undefined
  },

  isSupportedWireResponse(res: unknown): boolean {
    return res?.myCustomResponseField !== undefined
  },

  parseRequest(request: unknown): UnifiedRequest {
    // Convert wire format to unified
    const req = request as MyWireRequest
    return {
      messages: req.myMessages.map(m => ({
        role: m.role,
        parts: [{ type: 'text', text: m.text }]
      })),
      system: req.systemPrompt
    }
  },

  buildWireRequest(unified: UnifiedRequest, ctx: FormatContext): unknown {
    // Convert unified to wire format
    return {
      myMessages: unified.messages.map(m => ({
        role: m.role,
        text: m.parts.filter(p => p.type === 'text').map(p => p.text).join('')
      })),
      systemPrompt: unified.system
    }
  },

  parseResponse(response: unknown): UnifiedResponse {
    // Convert wire response to unified
  },

  buildWireResponse(unified: UnifiedResponse, ctx: FormatContext): unknown {
    // Convert unified response to wire format
  }
}
```

## Testing Round-Trips

```typescript
import { describe, it, expect } from 'bun:test'
import { MyCustomFormat } from './my-custom'

describe('MyCustomFormat round-trip', () => {
  it('preserves data through parse/build cycle', () => {
    const original = {
      myMessages: [{ role: 'user', text: 'Hello' }],
      systemPrompt: 'Be helpful'
    }

    const unified = MyCustomFormat.parseRequest(original)
    const rebuilt = MyCustomFormat.buildWireRequest(unified, {
      provider: 'custom',
      model: 'my-model'
    })

    expect(rebuilt).toEqual(original)
  })
})
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/formats/base.ts` | SchemaFormat interface |
| `packages/core/src/formats/types.ts` | Unified schema types |
| `packages/core/src/formats/openai-chat.ts` | OpenAI Chat implementation |
| `packages/core/src/formats/anthropic-messages.ts` | Anthropic implementation |
| `packages/core/src/formats/google-gemini.ts` | Gemini implementation |
| `packages/core/src/providers/base.ts` | Updated Provider interface |

## Common Pitfalls

1. **Anthropic arguments are objects** - Don't forget to parse/stringify
2. **Gemini role is `model`** - Not `assistant`
3. **Anthropic max_tokens required** - Use 4096 default
4. **OpenAI Responses uses different type names** - `input_text` not `text`

## Next Steps

1. See [test-cases.md](test-cases.md) for comprehensive test coverage
2. See [plan.md](plan.md) for implementation phases
3. See [schemas/](schemas/) for detailed format specifications
