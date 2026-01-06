# Contract: Provider Interface Update

**Location**: `packages/core/src/providers/base.ts`
**Type**: TypeScript Interface Extension

## Interface Changes

### Existing Provider Interface (to be extended)

```typescript
interface Provider {
  /** Provider identifier */
  readonly id: string
  
  /** Provider display name */
  readonly name: string
  
  // ... existing methods ...
}
```

### New Methods to Add

```typescript
import type { SchemaFormat } from '../formats/base'

interface Provider {
  // ... existing methods ...

  /**
   * Get the schema format to use for a specific model.
   * 
   * Most providers use a single format for all models, but some
   * (like OpenCode Zen) may route to different formats based on model.
   * 
   * @param model - Model identifier
   * @returns SchemaFormat instance to use
   * @throws Error if model is not supported
   * 
   * @example
   * // Simple provider - single format
   * getFormatForModel(model: string): SchemaFormat {
   *   return this.defaultFormat
   * }
   * 
   * // Multi-format provider
   * getFormatForModel(model: string): SchemaFormat {
   *   if (model.startsWith('gpt-')) return OpenAIChatFormat
   *   if (model.startsWith('claude-')) return AnthropicMessagesFormat
   *   throw new Error(`Unsupported model: ${model}`)
   * }
   */
  getFormatForModel(model: string): SchemaFormat

  /**
   * Detect the schema format from a wire request.
   * 
   * Optional - used when format needs to be auto-detected
   * from an incoming request (e.g., at a proxy endpoint).
   * 
   * @param request - Unknown wire request
   * @returns Detected SchemaFormat, or null if unknown
   */
  getFormatForWireRequest?(request: unknown): SchemaFormat | null
}
```

## BaseProvider Updates

```typescript
import type { SchemaFormat } from '../formats/base'
import type { UnifiedRequest, FormatContext } from '../formats/types'

abstract class BaseProvider implements Provider {
  abstract readonly id: string
  abstract readonly name: string
  
  /**
   * Default format for this provider.
   * Override getFormatForModel for multi-format providers.
   */
  protected abstract readonly defaultFormat: SchemaFormat
  
  /**
   * Default implementation - returns defaultFormat for all models.
   * Override for multi-format providers.
   */
  getFormatForModel(model: string): SchemaFormat {
    return this.defaultFormat
  }
  
  /**
   * Default implementation - tries each known format.
   * Override for custom detection logic.
   */
  getFormatForWireRequest(request: unknown): SchemaFormat | null {
    if (this.defaultFormat.isSupportedWireRequest(request)) {
      return this.defaultFormat
    }
    return null
  }
  
  /**
   * Helper: Parse request using appropriate format.
   */
  protected parseRequest(request: unknown): UnifiedRequest {
    const format = this.getFormatForWireRequest(request)
    if (!format) {
      throw new Error(`Unable to detect format for request`)
    }
    return format.parseRequest(request)
  }
  
  /**
   * Helper: Build wire request using appropriate format.
   */
  protected buildRequest(unified: UnifiedRequest, model: string): unknown {
    const format = this.getFormatForModel(model)
    const ctx: FormatContext = {
      provider: this.id,
      model
    }
    return format.buildWireRequest(unified, ctx)
  }
}
```

## Provider Migration Pattern

### Before (inline transformation)

```typescript
class OpenAIProvider extends BaseProvider {
  async complete(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
    // Inline transformation logic here
    const messages = this.transformMessages(request.messages)
    // ...
  }
}
```

### After (format delegation)

```typescript
import { OpenAIChatFormat } from '../formats/openai-chat'

class OpenAIProvider extends BaseProvider {
  protected readonly defaultFormat = OpenAIChatFormat
  
  async complete(request: unknown): Promise<unknown> {
    // Delegate to format
    const unified = this.parseRequest(request)
    // ... process ...
    const wireResponse = this.buildResponse(unifiedResponse, model)
    return wireResponse
  }
}
```

## Multi-Format Provider Example

```typescript
import { OpenAIChatFormat } from '../formats/openai-chat'
import { AnthropicMessagesFormat } from '../formats/anthropic-messages'
import { GoogleGeminiFormat } from '../formats/google-gemini'

const ZEN_MODEL_ROUTING: Record<string, SchemaFormat> = {
  'gpt-4': OpenAIChatFormat,
  'gpt-4o': OpenAIChatFormat,
  'gpt-4o-mini': OpenAIChatFormat,
  'claude-3-opus': AnthropicMessagesFormat,
  'claude-3-sonnet': AnthropicMessagesFormat,
  'claude-3.5-sonnet': AnthropicMessagesFormat,
  'gemini-2.0-flash': GoogleGeminiFormat,
}

class OpenCodeZenProvider extends BaseProvider {
  protected readonly defaultFormat = OpenAIChatFormat
  
  getFormatForModel(model: string): SchemaFormat {
    // Exact match
    if (ZEN_MODEL_ROUTING[model]) {
      return ZEN_MODEL_ROUTING[model]
    }
    
    // Prefix match
    for (const [prefix, format] of Object.entries(ZEN_MODEL_ROUTING)) {
      if (model.startsWith(prefix)) {
        return format
      }
    }
    
    // Error - no fallback (per spec decision)
    throw new Error(`Unsupported model for this provider: ${model}`)
  }
}
```

## See Also

- [schema-format.md](schema-format.md) - SchemaFormat interface
- [plan.md](../plan.md) - Phase 4 & 5 for provider migration
