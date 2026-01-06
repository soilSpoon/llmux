# Feature Specification: Provider Schema Refactor

**Feature Branch**: `018-provider-schema-refactor`
**Created**: 2026-01-06
**Status**: Draft
**Input**: User description: "Refactor provider schema architecture to decouple identity from wire format"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unified Provider Architecture (Priority: P1)

Developers can add new AI providers or schemas without modifying the core routing logic, by implementing a standardized `SchemaFormat` interface.

**Why this priority**: This is the core architectural change that enables scalability and maintainability of the multi-provider system.

**Independent Test**: Can be tested by implementing a mock format and verifying it works through the standard provider interface without special casing in the core.

**Acceptance Scenarios**:

1. **Given** a new `SchemaFormat` implementation (e.g., for a new provider type), **When** it is registered with a provider, **Then** requests are correctly parsed and formatted according to the new schema without core code changes.
2. **Given** a request for an OpenAI-compatible provider, **When** the request is processed, **Then** it uses the `OpenAIChatFormat` strategy transparently.

---

### User Story 2 - Lossless Round-Trip Transformation (Priority: P1)

Requests and responses undergo transformation from Provider A format to Unified format and back to Provider A format with zero semantic information loss.

**Why this priority**: Ensuring data integrity is critical for a proxy/middleware system. Users must get exactly what they expect from the underlying provider.

**Independent Test**: Can be tested via unit tests using complex payloads (multimodal, tools, etc.) for each supported format.

**Acceptance Scenarios**:

1. **Given** a complex OpenAI Chat request (tools, images, system prompt), **When** parsed to Unified and rebuilt, **Then** the output JSON matches the input JSON exactly (canonical equivalence).
2. **Given** an Anthropic streaming response, **When** parsed to Unified stream chunks and rebuilt, **Then** the resulting stream events match the original sequence and content.

---

### User Story 3 - Provider-Format Decoupling (Priority: P2)

A single Provider identity (e.g., 'opencode-zen') can dynamically select different schema formats (OpenAI Chat, Anthropic, Gemini) based on the requested model or configuration.

**Why this priority**: Enables "meta-providers" or routers that sit in front of multiple actual model APIs but present a single identity to the user.

**Independent Test**: Configure a provider to route model A to Format X and model B to Format Y, then verify correct formatting for each.

**Acceptance Scenarios**:

1. **Given** an 'opencode-zen' provider configured with mixed models, **When** requesting a GPT-4 model, **Then** it uses `OpenAIChatFormat`.
2. **Given** the same provider, **When** requesting a Claude 3 model, **Then** it uses `AnthropicMessagesFormat`.

### Edge Cases

- **Unknown Model Format**: System MUST return an error ("Unsupported model for this provider") if `getFormatForModel` cannot resolve a format. No fallback behavior.
- **Unsupported Features**: System MUST silently strip unsupported features during transformation and log a warning for observability. Transformation continues without error.
- **Malformed Upstream Response**: System MUST attempt best-effort parsing, extracting available fields. Error only if critical fields (e.g., `id`, `content`) are missing. Log warning for schema deviations.
- **Streaming Interruption**: System MUST emit an error chunk to the stream indicating the failure, then close the connection. Client receives partial results plus error notification.

### Out of Scope
- New provider implementations (only refactoring existing ones).
- Authentication logic changes.
- Endpoint routing changes (only schema transformation layer).

## Clarifications

### Session 2026-01-06
- Q: Unknown Model Format handling → A: Error immediately with "Unsupported model for this provider" (no fallback)
- Q: Unsupported Features handling → A: Strip unsupported features silently, log warning for observability
- Q: Malformed Upstream Response → A: Best-effort parsing, error only if critical fields missing, log warnings
- Q: Streaming Interruption → A: Emit error chunk to stream, then close (partial results preserved)
- Q: Out of scope → A: New providers, auth changes, routing changes
- Q: Tool arguments storage → A: Always store as object in Unified, stringify only when building OpenAI wire format
- Q: Default max_tokens for Anthropic → A: Use 4096 (same as LiteLLM)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST define a `SchemaFormat` interface with methods for request/response parsing and building.
- **FR-002**: System MUST implement `OpenAIChatFormat` supporting `/v1/chat/completions` schema (including tools, images, streaming).
- **FR-003**: System MUST implement `OpenAIResponsesFormat` supporting `/v1/responses` schema (including `input` fields, reasoning).
- **FR-004**: System MUST implement `AnthropicMessagesFormat` supporting `/v1/messages` schema (including system array, cache control).
- **FR-005**: System MUST implement `GoogleGeminiFormat` supporting `/v1/models/{model}:generateContent` schema.
- **FR-006**: Providers MUST allow selecting a `SchemaFormat` strategy dynamically per request or model.
- **FR-007**: System MUST support streaming transformations for all formats with equivalent event mapping.
- **FR-008**: Transformation logic MUST handle error responses from upstream providers and map them to a unified error format before serializing back to wire format.

### Key Entities *(include if feature involves data)*

- **SchemaFormat**: Stateless strategy object defining parse/build logic for a specific wire format.
- **UnifiedRequest**: Internal canonical representation of an LLM request (superset of all supported features).
- **UnifiedResponse**: Internal canonical representation of an LLM response.
- **FormatContext**: Context object passed during build (contains model, provider config, etc.).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of defined test cases for "A → Unified → A" round-trips pass for all 4 supported formats.
- **SC-002**: Adding a new format requires touching only 1 new file (the format implementation) and registering it, with 0 changes to existing provider logic.
- **SC-003**: Streaming latency overhead from transformation is < 5ms per chunk (p99).
- **SC-004**: Type safety is enforced; build fails if a format implementation misses required methods.

## Schema Reference

Detailed schema specifications are in the [schemas/](schemas/) directory:

- [unified.md](schemas/unified.md) - Hub format (internal canonical representation)
- [openai-chat.md](schemas/openai-chat.md) - `/v1/chat/completions`
- [openai-responses.md](schemas/openai-responses.md) - `/v1/responses`
- [anthropic-messages.md](schemas/anthropic-messages.md) - `/v1/messages`
- [google-gemini.md](schemas/google-gemini.md) - `/v1/models/{model}:generateContent`

### Quick Comparison Table

| Feature | OpenAI Chat | OpenAI Responses | Anthropic | Gemini |
|---------|-------------|------------------|-----------|--------|
| Message field | `messages` | `input` | `messages` | `contents` |
| Assistant role | `assistant` | `assistant` | `assistant` | `model` |
| Text type (user) | `text` | `input_text` | `text` | `{ text }` |
| Tool call location | `assistant.tool_calls[]` | standalone item | `tool_use` block | `functionCall` part |
| Tool arguments | string (JSON) | string (JSON) | **object** | **object** |
| Tool schema field | `parameters` | `parameters` | `input_schema` | `parameters` |
| System prompt | in messages | `instructions` | separate `system` | `systemInstruction` |
| Thinking/reasoning | N/A | `reasoning` | `thinking` block | `thought: true` |
| Cache control | N/A | N/A | on any block | N/A |

### Critical Implementation Notes

1. **Anthropic arguments are objects, not strings** - JSON.stringify when building OpenAI, JSON.parse when parsing OpenAI
2. **Gemini uses `model` role, not `assistant`** - Easy to miss, causes silent failures
3. **OpenAI Responses uses different type names** - `input_text`/`output_text` not `text`
4. **Anthropic `max_tokens` is required** - Must provide default if not in UnifiedRequest
5. **Content is always array in Anthropic** - Never just a string
