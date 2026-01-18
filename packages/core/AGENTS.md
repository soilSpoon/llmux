# Core Package Agents Guide

## Antigravity Provider Casing
- The Antigravity provider uses **camelCase** for internal request/response objects (matching Gemini format).
- The **wire format** (what is sent to the API) is converted to **snake_case** at the provider boundary (`transform` method).
- When testing `transform()` result (wire format), cast to `AntigravityWireRequest` or `Record<string, unknown>` and expect snake_case keys (e.g., `thinking_config`, `include_thoughts`).
- When testing `request.ts` internal helpers, expect camelCase.

## Exports
- Utilities used by `@llmux/server` must be exported from `packages/core/src/index.ts`.
- `recursiveStripSignatures` is required by server logging stores.

## Streaming
- Antigravity streaming chunks (`parseStreamChunk`) return loosely typed objects (`Record<string, unknown>`).
- When accessing optional fields like `thoughtSignature` or `thought_signature`, use explicit checks or type casting (e.g., `(part.thoughtSignature || part.thought_signature) as string | undefined`).

