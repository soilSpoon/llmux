import { describe, expect, it, beforeEach } from "bun:test";
import { Router } from "../routing";
import { CooldownManager } from "../cooldown";

describe("Router", () => {
  let router: Router;
  let cooldownManager: CooldownManager;

  const mockConfig = {
    modelMapping: {
      "gpt-4": {
        provider: "openai" as const,
        model: "gpt-4",
        fallbacks: ["gpt-3.5-turbo", "claude-3-opus"],
      },
      "gpt-3.5-turbo": {
        provider: "openai" as const,
        model: "gpt-3.5-turbo",
      },
      "claude-3-opus": {
        provider: "anthropic" as const,
        model: "claude-3-opus",
      },
      "gemini-pro": {
        provider: "gemini" as const,
        model: "gemini-pro",
      },
    },
    rotateOn429: true,
  };

  beforeEach(() => {
    cooldownManager = new CooldownManager();
    router = new Router(mockConfig, cooldownManager);
  });

  it("should resolve primary model by default", () => {
    const result = router.resolveModel("gpt-4");
    expect(result).toEqual({ provider: "openai", model: "gpt-4" });
  });

  it("should resolve fallback when primary is cooled down", () => {
    // Mark primary as rate limited
    router.handleRateLimit("gpt-4");

    // Verify cooldown status (indirectly via router logic)
    expect(cooldownManager.isAvailable("openai:gpt-4")).toBe(false);

    const result = router.resolveModel("gpt-4");
    // Should fallback to first fallback: gpt-3.5-turbo
    expect(result).toEqual({ provider: "openai", model: "gpt-3.5-turbo" });
  });

  it("should resolve second fallback when primary and first fallback are cooled down", () => {
    router.handleRateLimit("gpt-4");
    router.handleRateLimit("gpt-3.5-turbo");

    const result = router.resolveModel("gpt-4");
    expect(result).toEqual({ provider: "anthropic", model: "claude-3-opus" });
  });

  it("should return primary if all fallbacks are exhausted (failure mode)", () => {
    router.handleRateLimit("gpt-4");
    router.handleRateLimit("gpt-3.5-turbo");
    router.handleRateLimit("claude-3-opus");

    const result = router.resolveModel("gpt-4");
    // Based on implementation, should return primary
    expect(result).toEqual({ provider: "openai", model: "gpt-4" });
  });

  it("should fallback to default behavior for unmapped models", () => {
    const result = router.resolveModel("unknown-model");
    // Default fallback order[0] or openai if not set
    expect(result).toEqual({ provider: "openai", model: "unknown-model" });
  });
});
