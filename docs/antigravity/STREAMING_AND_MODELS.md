# Antigravity Streaming & Model Support

## Overview

Antigravity (Google's Unified Gateway API) supports streaming (SSE) for both Claude and Gemini models. Recent tests verify that `gemini-3-pro-high` and Claude models (subject to rate limits) successfully handle streaming requests.

## Streaming Support Status

| Model Family | Model ID | Streaming Status | Notes |
|--------------|----------|------------------|-------|
| **Gemini** | `gemini-3-pro-high` | ✅ **Supported** | Verified via `examples/test-all-accounts-streaming.ts`. Returns 200 OK. |
| **Claude** | `claude-sonnet-4-5` | ✅ **Supported** | Returns 429 (Rate Limit) or 200 OK. Endpoint exists. |
| **Claude** | `claude-opus-4-5-thinking` | ✅ **Supported** | Returns 429 (Rate Limit) or 200 OK. Endpoint exists. |

> **Note**: Previous reports of Gemini streaming returning 404 were likely due to specific model versions (`gemini-3-pro` vs `gemini-3-pro-high`) or temporary platform issues. Current tests confirm `gemini-3-pro-high` works.

## Reference Documentation

For detailed Antigravity API specification and architecture, see the external documentation:

- `../../../opencode-antigravity-auth/docs/ANTIGRAVITY_API_SPEC.md` - Full API reference
- `../../../opencode-antigravity-auth/docs/ARCHITECTURE.md` - Plugin architecture and request flow

### Key Specifications (from external docs)

- **Endpoint**: `/v1internal:streamGenerateContent?alt=sse`
- **Headers**:
  - `Accept: text/event-stream`
  - `User-Agent: antigravity/1.11.5 windows/amd64`
- **Request Format**: Gemini-style `contents` array (not Anthropic `messages`).

## Troubleshooting

- **429 Resource Exhausted**: Frequent on Claude models. Implement account rotation or retry logic.
- **500 Internal Error**: Can occur with extremely large requests (>400KB).
- **404 Not Found**: Ensure you are using the correct Model ID (e.g., `gemini-3-pro-high`).

## Verification

To verify streaming support for all configured accounts, run:

```bash
bun run examples/test-all-accounts-streaming.ts
```
