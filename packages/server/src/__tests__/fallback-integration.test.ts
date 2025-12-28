import { describe, expect, it, beforeEach } from "bun:test";
import { Router } from "../routing";
import { CooldownManager } from "../cooldown";
import type { RoutingConfig } from "../config";

/**
 * Integration tests for 429 fallback behavior
 *
 * These tests verify the complete flow from rate limit detection
 * to fallback model selection.
 */
describe("429 Fallback Integration", () => {
  let router: Router;
  let cooldownManager: CooldownManager;

  const config: RoutingConfig = {
    modelMapping: {
      "glm-4.7-free": {
        provider: "opencode-zen" as const,
        model: "glm-4.7-free",
        fallbacks: ["gemini-claude-opus-4-5-thinking"],
      },
      "gemini-claude-opus-4-5-thinking": {
        provider: "antigravity" as const,
        model: "gemini-claude-opus-4-5-thinking",
      },
      "primary-model": {
        provider: "openai" as const,
        model: "gpt-4",
        fallbacks: ["secondary-model", "tertiary-model"],
      },
      "secondary-model": {
        provider: "openai" as const,
        model: "gpt-3.5-turbo",
        fallbacks: ["tertiary-model"],
      },
      "tertiary-model": {
        provider: "anthropic" as const,
        model: "claude-3-sonnet",
      },
    },
    rotateOn429: true,
  };

  beforeEach(() => {
    cooldownManager = new CooldownManager();
    router = new Router(config, cooldownManager);
  });

  describe("Single fallback scenario", () => {
    it("should switch from glm-4.7-free to gemini-claude-opus on 429", () => {
      // Simulate 429 for primary model
      router.handleRateLimit("glm-4.7-free");

      const result = router.resolveModel("glm-4.7-free");

      expect(result).toEqual({
        provider: "antigravity",
        model: "gemini-claude-opus-4-5-thinking",
      });
    });

    it("should return to primary after cooldown expires", async () => {
      // Mark rate limited with very short duration (10ms)
      cooldownManager.markRateLimited("opencode-zen:glm-4.7-free", 10);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = router.resolveModel("glm-4.7-free");

      expect(result).toEqual({
        provider: "opencode-zen",
        model: "glm-4.7-free",
      });
    });
  });

  describe("Cascading fallback scenario", () => {
    it("should cascade through all fallbacks", () => {
      // Mark primary as rate limited
      router.handleRateLimit("primary-model");

      let result = router.resolveModel("primary-model");
      expect(result.model).toBe("gpt-3.5-turbo");

      // Mark secondary as rate limited too
      router.handleRateLimit("secondary-model");

      result = router.resolveModel("primary-model");
      expect(result.model).toBe("claude-3-sonnet");
      expect(result.provider).toBe("anthropic");
    });

    it("should return primary when all fallbacks exhausted", () => {
      router.handleRateLimit("primary-model");
      router.handleRateLimit("secondary-model");
      router.handleRateLimit("tertiary-model");

      const result = router.resolveModel("primary-model");

      // When all are down, return primary (caller will get 429)
      expect(result.model).toBe("gpt-4");
    });
  });

  describe("Provider switching", () => {
    it("should correctly switch providers during fallback", () => {
      // OpenAI -> Anthropic transition
      router.handleRateLimit("primary-model");
      router.handleRateLimit("secondary-model");

      const result = router.resolveModel("primary-model");

      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-3-sonnet");
    });

    it("should correctly switch from opencode-zen to antigravity", () => {
      router.handleRateLimit("glm-4.7-free");

      const result = router.resolveModel("glm-4.7-free");

      expect(result.provider).toBe("antigravity");
    });
  });

  describe("Retry-After header handling", () => {
    it("should respect specific Retry-After duration", () => {
      const retryAfterMs = 120000; // 2 minutes
      cooldownManager.markRateLimited("openai:gpt-4", retryAfterMs);

      const resetTime = cooldownManager.getResetTime("openai:gpt-4");
      const expectedMinReset = Date.now() + retryAfterMs;

      // Reset time should be at least retryAfterMs in future (with jitter)
      expect(resetTime).toBeGreaterThanOrEqual(expectedMinReset);
    });

    it("should use exponential backoff without Retry-After", () => {
      // First 429 - base 30s
      const d1 = cooldownManager.markRateLimited("openai:test");
      // Second 429 - 60s
      const d2 = cooldownManager.markRateLimited("openai:test");
      // Third 429 - 120s
      const d3 = cooldownManager.markRateLimited("openai:test");

      // Verify exponential growth (accounting for jitter)
      expect(d2).toBeGreaterThan(d1);
      expect(d3).toBeGreaterThan(d2);
    });
  });

  describe("Concurrent models", () => {
    it("should handle multiple models independently", () => {
      // Rate limit glm but not primary-model
      router.handleRateLimit("glm-4.7-free");

      const glmResult = router.resolveModel("glm-4.7-free");
      const primaryResult = router.resolveModel("primary-model");

      // GLM should fallback
      expect(glmResult.model).toBe("gemini-claude-opus-4-5-thinking");
      // Primary should still work
      expect(primaryResult.model).toBe("gpt-4");
    });
  });
});
