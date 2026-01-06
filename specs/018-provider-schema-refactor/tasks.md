# Tasks: Provider Schema Refactor

**Input**: Design documents from `/specs/018-provider-schema-refactor/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: TDD approach - tests are written first per plan.md specification.

**Organization**: Tasks are grouped by user story and plan phases to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is a monorepo project:
- **Core package**: `packages/core/src/`
- **Server package**: `packages/server/src/`
- **Tests**: `packages/core/test/`

---

## Phase 1: Setup (Project Structure)

**Purpose**: Create format module structure and type definitions

- [x] T001 Create formats directory at `packages/core/src/formats/`
- [x] T002 Create `packages/core/src/formats/types.ts` with Unified schema types from [schemas/unified.md](schemas/unified.md)
- [x] T003 Create `packages/core/src/formats/base.ts` with SchemaFormat interface from [contracts/schema-format.md](contracts/schema-format.md)
- [x] T004 Create `packages/core/src/formats/index.ts` barrel export
- [x] T005 Run `bun run typecheck` to verify types compile

**Checkpoint**: Format module structure ready, types defined ✅

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before format implementations

**⚠️ CRITICAL**: No format implementation can begin until this phase is complete

- [ ] T006 Create test directory at `packages/core/test/formats/`
- [ ] T007 Create test helpers for round-trip testing in `packages/core/test/formats/helpers.ts`
- [ ] T008 [P] Create test fixtures directory at `packages/core/test/formats/fixtures/`
- [ ] T009 [P] Create OpenAI Chat fixtures in `packages/core/test/formats/fixtures/openai-chat/`
- [ ] T010 [P] Create OpenAI Responses fixtures in `packages/core/test/formats/fixtures/openai-responses/`
- [ ] T011 [P] Create Anthropic fixtures in `packages/core/test/formats/fixtures/anthropic/`
- [ ] T012 [P] Create Gemini fixtures in `packages/core/test/formats/fixtures/gemini/`
- [ ] T013 Run `bun run test` to verify test infrastructure works

**Checkpoint**: Test infrastructure ready - format implementation can now begin

---

## Phase 3: User Story 1 - Unified Provider Architecture (Priority: P1) 🎯 MVP

**Goal**: Implement SchemaFormat interface and 4 format implementations that pass round-trip tests

**Independent Test**: All `A → Unified → A` round-trip tests pass for each format

### 3.1 OpenAI Chat Format Tests (TDD)

- [ ] T014 [US1] Write round-trip test for simple user message in `packages/core/test/formats/openai-chat.test.ts`
- [ ] T015 [P] [US1] Write round-trip test for multimodal content (text + image)
- [ ] T016 [P] [US1] Write round-trip test for tool calls in assistant message
- [ ] T017 [P] [US1] Write round-trip test for tool result message
- [ ] T018 [P] [US1] Write round-trip test for system prompt
- [ ] T019 [P] [US1] Write streaming chunk parsing tests
- [ ] T020 [US1] Run tests - verify they FAIL (no implementation yet)

### 3.2 OpenAI Chat Format Implementation

- [x] T021 [US1] Implement `isSupportedWireRequest` in `packages/core/src/formats/openai-chat.ts`
- [x] T022 [US1] Implement `parseRequest` - message parsing
- [x] T023 [US1] Implement `parseRequest` - tool calls parsing
- [x] T024 [US1] Implement `buildWireRequest` - message building
- [x] T025 [US1] Implement `buildWireRequest` - tool calls building (stringify arguments)
- [x] T026 [US1] Implement `parseResponse` and `buildWireResponse`
- [x] T027 [US1] Implement `parseStreamChunk` and `buildStreamChunk`
- [x] T028 [US1] Run tests - verify they PASS
- [x] T029 [US1] Add format to `packages/core/src/formats/index.ts` exports

### 3.3 OpenAI Responses Format Tests (TDD)

- [ ] T030 [P] [US1] Write round-trip test for simple input_text in `packages/core/test/formats/openai-responses.test.ts`
- [ ] T031 [P] [US1] Write round-trip test for instructions field
- [ ] T032 [P] [US1] Write round-trip test for function_call item
- [ ] T033 [P] [US1] Write round-trip test for function_call_output item
- [ ] T034 [US1] Run tests - verify they FAIL

### 3.4 OpenAI Responses Format Implementation

- [x] T035 [US1] Implement `isSupportedWireRequest` in `packages/core/src/formats/openai-responses.ts`
- [x] T036 [US1] Implement `parseRequest` - handle input_text/output_text types
- [x] T037 [US1] Implement `parseRequest` - handle function_call/function_call_output
- [x] T038 [US1] Implement `buildWireRequest` - convert text to input_text/output_text
- [x] T039 [US1] Implement `parseResponse` and `buildWireResponse`
- [x] T040 [US1] Implement streaming methods
- [x] T041 [US1] Run tests - verify they PASS
- [x] T042 [US1] Add format to exports

### 3.5 Anthropic Messages Format Tests (TDD)

- [ ] T043 [P] [US1] Write round-trip test for text array content in `packages/core/test/formats/anthropic-messages.test.ts`
- [ ] T044 [P] [US1] Write round-trip test for separate system array
- [ ] T045 [P] [US1] Write round-trip test for cache_control preservation
- [ ] T046 [P] [US1] Write round-trip test for tool_use with object arguments
- [ ] T047 [P] [US1] Write round-trip test for tool_result with nested content
- [ ] T048 [P] [US1] Write round-trip test for thinking block with signature
- [ ] T049 [US1] Write streaming event parsing tests
- [ ] T050 [US1] Run tests - verify they FAIL

### 3.6 Anthropic Messages Format Implementation

- [x] T051 [US1] Implement `isSupportedWireRequest` in `packages/core/src/formats/anthropic-messages.ts`
- [x] T052 [US1] Implement `parseRequest` - separate system handling
- [x] T053 [US1] Implement `parseRequest` - content always array
- [x] T054 [US1] Implement `parseRequest` - tool_use with object arguments
- [x] T055 [US1] Implement `buildWireRequest` - system array building
- [x] T056 [US1] Implement `buildWireRequest` - add max_tokens default (4096)
- [x] T057 [US1] Implement `parseResponse` and `buildWireResponse`
- [x] T058 [US1] Implement streaming event parsing (message_start, content_block_*, message_delta)
- [x] T059 [US1] Run tests - verify they PASS
- [x] T060 [US1] Add format to exports

### 3.7 Google Gemini Format Tests (TDD)

- [ ] T061 [P] [US1] Write round-trip test for simple text part in `packages/core/test/formats/google-gemini.test.ts`
- [ ] T062 [P] [US1] Write round-trip test for role mapping (model ↔ assistant)
- [ ] T063 [P] [US1] Write round-trip test for systemInstruction field
- [ ] T064 [P] [US1] Write round-trip test for functionCall with object args
- [ ] T065 [P] [US1] Write round-trip test for functionResponse with name
- [ ] T066 [P] [US1] Write round-trip test for thought: true flag
- [ ] T067 [US1] Run tests - verify they FAIL

### 3.8 Google Gemini Format Implementation

- [x] T068 [US1] Implement `isSupportedWireRequest` in `packages/core/src/formats/google-gemini.ts`
- [x] T069 [US1] Implement `parseRequest` - role mapping (model → assistant)
- [x] T070 [US1] Implement `parseRequest` - text parts without type field
- [x] T071 [US1] Implement `parseRequest` - functionCall with args
- [x] T072 [US1] Implement `buildWireRequest` - role mapping (assistant → model)
- [x] T073 [US1] Implement `buildWireRequest` - functionResponse with name
- [x] T074 [US1] Implement `parseResponse` and `buildWireResponse`
- [x] T075 [US1] Implement streaming methods
- [x] T076 [US1] Run tests - verify they PASS
- [x] T077 [US1] Add format to exports

### 3.9 User Story 1 Validation

- [ ] T078 [US1] Run full test suite: `bun run test`
- [ ] T079 [US1] Run type check: `bun run typecheck`
- [ ] T080 [US1] Run lint: `bun run lint`

**Checkpoint**: All 4 formats implemented with passing round-trip tests. User Story 1 complete.

---

## Phase 4: User Story 2 - Lossless Round-Trip Transformation (Priority: P1)

**Goal**: Comprehensive round-trip testing including cross-format transformations

**Independent Test**: Complex payloads (multimodal, tools, streaming) pass round-trip for all formats

### 4.1 Cross-Format Tests

- [ ] T081 [P] [US2] Write cross-format test: OpenAI Chat → Anthropic → OpenAI Chat in `packages/core/test/formats/cross-format.test.ts`
- [ ] T082 [P] [US2] Write cross-format test: OpenAI Chat → Gemini → OpenAI Chat
- [ ] T083 [P] [US2] Write cross-format test: Anthropic → OpenAI Chat → Anthropic
- [ ] T084 [US2] Write lossy transformation test (cache_control lost when converting to OpenAI)
- [ ] T085 [US2] Verify warnings are logged for lossy transforms

### 4.2 Edge Case Tests

- [ ] T086 [P] [US2] Write test for malformed upstream response (best-effort parsing)
- [ ] T087 [P] [US2] Write test for unsupported feature stripping with warning
- [ ] T088 [P] [US2] Write test for streaming interruption error handling
- [ ] T089 [US2] Run all edge case tests - verify they PASS

### 4.3 Streaming Integration Tests

- [ ] T090 [US2] Write streaming round-trip test for OpenAI Chat in `packages/core/test/formats/streaming.test.ts`
- [ ] T091 [P] [US2] Write streaming round-trip test for Anthropic (event sequence)
- [ ] T092 [P] [US2] Write streaming round-trip test for Gemini
- [ ] T093 [US2] Run streaming tests - verify they PASS

**Checkpoint**: All round-trip and cross-format tests pass. User Story 2 complete.

---

## Phase 5: User Story 3 - Provider-Format Decoupling (Priority: P2)

**Goal**: Update Provider interface to support dynamic format selection

**Independent Test**: OpenCode Zen provider correctly routes different models to different formats

### 5.1 Provider Interface Update

- [x] T094 [US3] Add `getFormatForModel` to Provider interface in `packages/core/src/providers/base.ts`
- [x] T095 [US3] Add `getFormatForWireRequest` optional method to Provider interface
- [x] T096 [US3] Update BaseProvider with default format delegation
- [x] T097 [US3] Write provider-format composition tests in `packages/core/test/providers/format-delegation.test.ts`
- [x] T098 [US3] Run tests - verify they PASS

### 5.2 Provider Migration - OpenAI

- [x] T099 [US3] Refactor OpenAI provider to use `OpenAIChatFormat` in `packages/core/src/providers/openai/`
- [x] T100 [US3] Run existing OpenAI provider tests
- [x] T101 [US3] Verify no behavior change

### 5.3 Provider Migration - OpenAI Web

- [x] T102 [US3] Refactor OpenAI Web provider to use `OpenAIResponsesFormat` in `packages/core/src/providers/openai-web/`
- [x] T103 [US3] Remove inline text → input_text conversion (now in format)
- [x] T104 [US3] Run existing OpenAI Web provider tests

### 5.4 Provider Migration - Anthropic

- [x] T105 [US3] Refactor Anthropic provider to use `AnthropicMessagesFormat` in `packages/core/src/providers/anthropic/`
- [x] T106 [US3] Run existing Anthropic provider tests

### 5.5 Provider Migration - Google/Antigravity

- [x] T107 [US3] Refactor Google/Antigravity provider to use `GoogleGeminiFormat` in `packages/core/src/providers/antigravity/`
- [x] T108 [US3] Run existing Antigravity provider tests

### 5.6 Provider Migration - OpenCode Zen (Multi-Format)

- [x] T109 [US3] Define `ZEN_MODEL_ROUTING` table in `packages/core/src/providers/opencode-zen/`
- [x] T110 [US3] Implement `getFormatForModel` with routing logic
- [x] T111 [US3] Add error for unsupported model (no fallback per spec)
- [x] T112 [US3] Write multi-format routing tests
- [x] T113 [US3] Run existing OpenCode Zen provider tests

### 5.7 User Story 3 Validation

- [ ] T114 [US3] Run full test suite: `bun run test`
- [ ] T115 [US3] Run type check: `bun run typecheck`

**Checkpoint**: All providers migrated to use format system. User Story 3 complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Server integration, cleanup, and final validation

- [ ] T116 Verify `packages/server` works with updated providers
- [ ] T117 [P] Verify streaming pipelines work end-to-end
- [ ] T118 [P] Identify and remove dead code from old provider implementations
- [ ] T119 [P] Update quickstart.md with final code examples
- [ ] T120 Run full test suite: `bun run test`
- [ ] T121 Run type check: `bun run typecheck`
- [ ] T122 Run lint: `bun run lint`
- [ ] T123 Run build: `bun run build`
- [ ] T124 Verify all quality gates pass with zero errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all format work
- **Phase 3 (US1)**: Depends on Phase 2 - Core format implementations
- **Phase 4 (US2)**: Depends on Phase 3 - Extended testing
- **Phase 5 (US3)**: Depends on Phase 3 - Provider migration
- **Phase 6 (Polish)**: Depends on Phase 5

### User Story Dependencies

- **US1**: Can start after Phase 2 - No dependencies on other stories
- **US2**: Depends on US1 (uses format implementations)
- **US3**: Depends on US1 (uses format implementations), can run parallel with US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Type definitions before implementation
- Implementation before integration
- All tests pass before moving to next phase

### Parallel Opportunities

**Phase 2** (Fixtures):
```bash
# Launch fixture creation in parallel:
Task: "Create OpenAI Chat fixtures" (T009)
Task: "Create OpenAI Responses fixtures" (T010)
Task: "Create Anthropic fixtures" (T011)
Task: "Create Gemini fixtures" (T012)
```

**Phase 3** (Format Tests - within each format):
```bash
# Launch OpenAI Chat tests in parallel:
Task: "Write multimodal test" (T015)
Task: "Write tool calls test" (T016)
Task: "Write tool result test" (T017)
Task: "Write system prompt test" (T018)
```

**Phase 5** (Provider Migration):
```bash
# After interface update (T094-T098), migrate providers in parallel:
Task: "Migrate OpenAI provider" (T099-T101)
Task: "Migrate OpenAI Web provider" (T102-T104)
Task: "Migrate Anthropic provider" (T105-T106)
Task: "Migrate Antigravity provider" (T107-T108)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (4 format implementations)
4. **STOP and VALIDATE**: All round-trip tests pass
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Infrastructure ready
2. Add US1 → 4 formats working with tests → MVP!
3. Add US2 → Cross-format and edge case testing → Quality assured
4. Add US3 → Providers migrated → Full feature complete
5. Polish → Production ready

---

## Summary

| Phase | Tasks | Parallel | Story |
|-------|-------|----------|-------|
| Phase 1: Setup | T001-T005 | 0 | - |
| Phase 2: Foundational | T006-T013 | 5 | - |
| Phase 3: User Story 1 | T014-T080 | 30+ | US1 |
| Phase 4: User Story 2 | T081-T093 | 8 | US2 |
| Phase 5: User Story 3 | T094-T115 | 4 | US3 |
| Phase 6: Polish | T116-T124 | 3 | - |
| **Total** | **124 tasks** | **50+ parallel** | |

**MVP Scope**: Phases 1-3 (T001-T080) - 80 tasks
**Full Feature**: All phases (T001-T124) - 124 tasks
