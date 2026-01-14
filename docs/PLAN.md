# Project Plan

**Status**: ✅ Active Maintenance / Stable

## 📅 Version History

- **v1.0**: Initial Release (Core + Server + Auth)
- **v2.0**: Refactoring & Architecture Improvements (Jan 2026)

## ✅ Completed Milestones

### Core & Infrastructure
- [x] Monorepo setup (Bun workspaces)
- [x] Core transformation logic (`@llmux/core`)
- [x] Authentication module (`@llmux/auth`)
- [x] Server implementation (`@llmux/server`)
- [x] CLI tools (`@llmux/cli`)

### Refactoring (Phase 1-7)
- [x] **Layer Separation**: Extracted `upstream`, `providers`, `routing` layers.
- [x] **Handler Cleanup**: Reduced handler size by delegating logic.
- [x] **Unified Routing**: Implemented `ModelRouter` for centralized resolution.
- [x] **Antigravity Optimization**: Dedicated provider helper for auth/context.
- [x] **Hub-and-Spoke Architecture**: Provider-Format decoupling complete (Jan 2026)
  - Moved streaming pipeline from GoogleGeminiFormat to AntigravityProvider
  - Implemented unified Builder pattern (Anthropic, OpenAI, Gemini)
  - Consolidated SSE accumulator logic
  - Removed legacy streaming fallback
  - 95% Hub-and-Spoke compliance achieved

### Features
- [x] Bidirectional Transformation (OpenAI, Anthropic, Gemini)
- [x] Streaming Support (SSE)
- [x] Thinking Block Support (Claude, Gemini)
- [x] OAuth Integration (GitHub Copilot, Antigravity)

## 🟢 Current Work - IN PROGRESS

### Phase 3-4: Hub-and-Spoke Architecture Finalization (95% → 100%)

**Status**: 🟡 In Progress (2026-01-14)
**Goal**: Remove remaining provider-specific branching from handlers and de-bloat large files

#### ✅ Completed (2026-01-14)

1. **Strategy Pattern Infrastructure** ✅
   - Created `packages/core/src/types/provider-strategies.ts`
     - 4 strategy interfaces: UpstreamPreparationStrategy, ThinkingStrategyResolver, MetadataInjectionStrategy, RateLimitStrategy
   - Extended `Provider` interface with `getStrategy<T>(type: StrategyType): T | null`
   - Implemented all 4 Antigravity strategies in `packages/server/src/providers/antigravity-strategies.ts`
     - AntigravityUpstreamStrategy (wraps prepareAntigravityRequest)
     - ClaudeFreshThinkingStrategy (Claude Fresh signature handling)
     - AntigravityMetadataStrategy (project/model/requestId injection)
     - ClaudeWeeklyLimitStrategy (weekly limit detection)

2. **Handler Refactoring (P1 - COMPLETE)** ✅
   - `upstream-request-builder.ts:105` - Refactored Antigravity upstream preparation to use AntigravityUpstreamStrategy
   - `upstream-request-builder.ts:274` - Refactored metadata injection to use AntigravityMetadataStrategy
   - `request-handler.ts:226` - Refactored weekly limit detection to use ClaudeWeeklyLimitStrategy
   - `responses.ts:72` - Deferred to auth provider refactor (not a handler responsibility)
   - `streaming.ts:48` - Logging only, no business logic (deferred)

**Impact**: Removed 3 major `if (provider === 'antigravity')` branches from handlers using Strategy Pattern

#### 🚧 Next Steps (Ralph Loop Iteration 2+)

1. **Verification & Testing**:
   - [ ] Fix DTS bundling error: "Multiple exports with the same name 'OpenAIMessage'"
   - [ ] Run `bun run typecheck && bun run test`
   - [ ] Verify no regressions in Antigravity functionality

2. **P2 Handler Refactoring** (Lower Priority):
   - [ ] `responses-stream.ts:51` - Enforce `getFormatForModel()` implementation
   - [ ] `caching-utils.ts:19` - Add `getCachingBehavior()` optional method
   - [ ] `family-rate-limiting.ts:30` - Extract family detection to strategy

3. **Phase 4 File De-Bloating**:
   - [ ] Split `streaming-pipeline.ts` (469 lines) → parser/builder (2 files)
   - [ ] Split `upstream-request-builder.ts` (444 lines) → context/transform (3 files)
   - [ ] Split `request-handler.ts` (437 lines) → rate-limit handler (2 files)

4. **Final Verification**:
   - [ ] `grep -r "provider === 'antigravity'" packages/server/src/handlers/` → Minimal results
   - [ ] All tests passing
   - [ ] No TypeScript errors
   - [ ] Documentation updated

---

#### Decision Log

**Original Proposal**: Extend `Provider` interface with 6+ optional methods
❌ **Rejected**: Would bloat interface and reduce consistency

**Selected Approach**: **Strategy Pattern + Composition**
✅ **Rationale**:
- Keeps Provider interface clean
- Strategies are independently testable
- Promotes code reuse across providers
- Follows SOLID principles (Single Responsibility, Open-Closed)

---

### Phase 3: Complete Antigravity Encapsulation

**Objective**: Remove all `if (provider === 'antigravity')` branches from handlers

#### 3.1 Create Strategy Interfaces (NEW)

```
packages/core/src/types/
├── provider-strategies.ts (NEW)
│   ├── UpstreamPreparationStrategy
│   ├── ThinkingStrategyResolver
│   ├── MetadataInjectionStrategy
│   └── RateLimitStrategy
└── provider.ts (MODIFY)
    └── Add getStrategy<T>() method
```

**Design**:
```typescript
// Composition over interface pollution
interface Provider {
  // Existing methods...
  getStrategy<T extends ProviderStrategy>(type: StrategyType): T | null
}

// Antigravity uses all strategies
class AntigravityProvider extends BaseProvider {
  private strategies = {
    upstream: new AntigravityUpstreamStrategy(),
    thinking: new ClaudeFreshThinkingStrategy(),
    metadata: new AntigravityMetadataStrategy(),
    rateLimit: new ClaudeWeeklyLimitStrategy(),
  }

  getStrategy<T>(type: StrategyType): T | null {
    return this.strategies[type] as T ?? null
  }
}

// OpenAI uses minimal strategies
class OpenAIProvider extends BaseProvider {
  private strategies = {
    thinking: new StandardThinkingStrategy(),
  }
}
```

#### 3.2 Handler Refactoring Priorities

| File | Current Branch | Refactoring | Priority |
|------|----------------|-------------|----------|
| `upstream-request-builder.ts:105` | `if (provider === 'antigravity')` → `prepareAntigravityRequest()` | `const strategy = provider.getStrategy<UpstreamPreparationStrategy>('upstream'); if (strategy) await strategy.prepare(...)` | P1 |
| `upstream-request-builder.ts:274` | `if (provider === 'antigravity')` → metadata injection | `const strategy = provider.getStrategy<MetadataInjectionStrategy>('metadata')` | P1 |
| `responses.ts:72` | `if (provider === 'antigravity')` → streaming endpoint | Move to `AntigravityProvider.getEndpoint(model, {streaming: true})` | P1 |
| `streaming.ts:48` | `if (requestMeta.isClaudeFresh)` | `const strategy = provider.getStrategy<ThinkingStrategyResolver>('thinking'); strategy.getMode(model)` | P1 |
| `request-handler.ts:226` | `if (provider === 'antigravity' && isClaudeWeeklyLimit)` | `const strategy = provider.getStrategy<RateLimitStrategy>('rateLimit')` | P2 |
| `responses-stream.ts:51` | `if (provider === 'antigravity')` → formatId fallback | Enforce `Provider.getFormatForModel()` implementation | P2 |
| `caching-utils.ts:19` | `if (provider === 'antigravity')` → ephemeral caching | `provider.getCachingBehavior?.() ?? 'standard'` (simple optional method OK) | P3 |

**Success Criteria**:
```bash
# Zero Antigravity branches in handlers
grep -r "provider === 'antigravity'" packages/server/src/handlers/ # → 0 results
grep -r "isClaudeFresh" packages/server/src/handlers/ # → Only in thinking-utils.ts

# Tests pass
bun run typecheck && bun run test
```

---

### Phase 4: File De-Bloating (400+ lines → <300 lines)

**Objective**: Split large files by responsibility, not by format

#### 4.1 streaming-pipeline.ts (469 lines) → 2 files

**❌ DON'T**: Split by Anthropic vs Gemini (causes code duplication)
**✅ DO**: Split by streaming phase

```
packages/core/src/providers/antigravity/
├── streaming-pipeline.ts (200 lines)
│   ├── AntigravityStreamingPipeline class
│   ├── parseChunk() → delegates to parser
│   └── buildChunk() → delegates to builder
├── streaming-parser.ts (150 lines) (NEW)
│   ├── parseAnthropicEvent()
│   ├── parseGeminiEvent()
│   └── detectEventFormat()
└── streaming-builder.ts (120 lines) (NEW)
    ├── buildAnthropicSSE()
    ├── buildGeminiSSE()
    └── formatSSEEvent()
```

**Rationale**: Parser/Builder separation mirrors existing `request.ts`/`response.ts` pattern

#### 4.2 upstream-request-builder.ts (444 lines) → 3 files

```
packages/server/src/handlers/
├── upstream-request-builder.ts (150 lines)
│   └── Main orchestration: buildUpstreamRequest()
├── upstream/
│   ├── provider-context.ts (150 lines) (NEW)
│   │   ├── resolveAntigravityContext()
│   │   ├── resolveOpenAIWebContext()
│   │   └── resolveGeminiCliContext()
│   └── transform-pipeline.ts (150 lines) (NEW)
│       ├── applyThinkingOverride()
│       ├── applyPromptCaching()
│       └── executeTransform()
```

#### 4.3 request-handler.ts (437 lines) → 2 files

```
packages/server/src/handlers/
├── request-handler.ts (220 lines)
│   └── Main request flow + error handling
└── rate-limit-handler.ts (220 lines) (NEW)
    ├── handle429Response()
    ├── selectAlternativeModel()
    └── logRateLimitEvent()
```

#### 4.4 streaming.ts (434 lines) - DEFER

**Reason**: Already well-structured, wait for Phase 4.1-4.3 learnings

**Deferred files**:
- `stream-transformer.ts` (414 lines) - Review after Phase 4.1
- `tool-pairing.ts` (405 lines) - Out of scope (not Hub-and-Spoke related)
- `thinking-recovery.ts` (405 lines) - Out of scope

---

### Implementation Sequence

```
Week 1: Phase 3 - Strategy Pattern Foundation
  Day 1-2: Create provider-strategies.ts + base implementations
  Day 3-4: Refactor P1 handlers (upstream-request-builder, responses, streaming)
  Day 5:   Refactor P2 handlers + Run full test suite

Week 2: Phase 4 - File De-Bloating
  Day 1-2: Split streaming-pipeline.ts
  Day 3:   Split upstream-request-builder.ts
  Day 4:   Split request-handler.ts
  Day 5:   Integration testing + Documentation update
```

---

### Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing tests | HIGH | Run tests after each P1 task |
| Strategy pattern over-engineering | MEDIUM | Start with 4 strategy types only, expand as needed |
| File splits cause import hell | MEDIUM | Keep original file as re-export barrel |
| Performance regression | LOW | Benchmark streaming throughput before/after |

---

### Success Metrics (Phase 3-4 Complete = 100% Hub-and-Spoke)

- [ ] Zero provider-specific conditionals in handlers
- [ ] All 400+ line files split to <300 lines
- [ ] No test failures
- [ ] No TypeScript errors
- [ ] Streaming throughput maintained (±5%)
- [ ] Documentation updated (ARCHITECTURE.md)

---

## 🔜 Future Roadmap

- [ ] **Phase 5**: Enhanced Metrics & Telemetry
- [ ] **Phase 6**: Web UI for Management
- [ ] **Phase 7**: Plugin System for Custom Providers

## 📚 Reference

- [Architecture Guide](ARCHITECTURE.md)
- [API Endpoints](ENDPOINTS.md)
