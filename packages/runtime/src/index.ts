/**
 * @llmux/runtime - LLM Provider Runtime
 *
 * Execution interfaces and strategies for LLM provider operations.
 * This package contains execution-related types that were moved out of @llmux/core
 * to maintain separation between transformation logic and runtime execution.
 *
 * @example
 * ```typescript
 * import type { UpstreamPreparationStrategy, RateLimitStrategy } from '@llmux/runtime'
 *
 * // Implement custom strategies for your provider
 * const myStrategy: UpstreamPreparationStrategy = {
 *   prepareUpstream(context, options) {
 *     // ...
 *   }
 * }
 * ```
 */

// Re-export types as they are migrated from @llmux/core
// This file will be populated in subsequent user stories (US-102, US-103, US-104)
