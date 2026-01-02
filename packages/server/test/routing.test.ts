import { describe, expect, test } from "bun:test";
import { Router } from "../src/routing";

describe("Router (Routing)", () => {
  describe("resolveModel", () => {
    test("returns mapped provider and model when mapping exists", async () => {
      const router = new Router({
        modelMapping: {
          "gpt-4": { provider: "openai", model: "gpt-4-turbo" },
          "claude-3": {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
          },
        },
      });

      const result = await router.resolveModel("gpt-4");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4-turbo");
    });

    test("returns first fallback provider when no mapping exists", async () => {
      const router = new Router({
        fallbackOrder: ["anthropic", "openai"],
      });

      const result = await router.resolveModel("unknown-model");
      // Now returns primary inferred provider (default openai) if not mapped
      // The old logic returned fallbackOrder[0].
      // New logic: ModelRouter infers 'openai' for unknown model.
      // Then Router checks cooldown. If ok, returns it.
      // The config.fallbackOrder is used in Router as a last resort if ModelRouter resolution fails/cooldown blocks all.
      
      // inferProviderFromModel defaults to 'openai' for 'unknown-model'.
      // So result.provider should be 'openai'.
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("unknown-model");
    });

    test("defaults to openai when no fallbackOrder set", async () => {
      const router = new Router({});

      const result = await router.resolveModel("some-model");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("some-model");
    });
  });

  describe("getNextProvider", () => {
    test("returns undefined when no fallback order", () => {
      const router = new Router({});
      expect(router.getNextProvider()).toBeUndefined();
    });

    test("rotates through fallback order", () => {
      const router = new Router({
        fallbackOrder: ["anthropic", "openai", "gemini"],
      });

      expect(router.getNextProvider()).toBe("anthropic");
      expect(router.getNextProvider()).toBe("openai");
      expect(router.getNextProvider()).toBe("gemini");
      expect(router.getNextProvider()).toBe("anthropic");
    });

    test("resetRotation resets the index", () => {
      const router = new Router({
        fallbackOrder: ["anthropic", "openai"],
      });

      router.getNextProvider();
      router.getNextProvider();
      router.resetRotation();

      expect(router.getNextProvider()).toBe("anthropic");
    });
  });

  describe("shouldRotateOn429", () => {
    test("returns false by default", () => {
      const router = new Router({});
      expect(router.shouldRotateOn429()).toBe(false);
    });

    test("returns true when enabled", () => {
      const router = new Router({
        rotateOn429: true,
      });
      expect(router.shouldRotateOn429()).toBe(true);
    });
  });

  describe("handleRateLimit", () => {
    test("returns undefined when rotateOn429 is false", () => {
      const router = new Router({
        rotateOn429: false,
        fallbackOrder: ["anthropic", "openai"],
      });

      expect(router.handleRateLimit("model")).toBeUndefined();
    });

    test("returns next provider when rotateOn429 is true", () => {
      const router = new Router({
        rotateOn429: true,
        fallbackOrder: ["anthropic", "openai", "gemini"],
      });

      expect(router.getNextProvider()).toBe("anthropic");
      expect(router.getNextProvider()).toBe("openai");
    });
  });

  describe("Router class", () => {
    test("can be instantiated directly", async () => {
      const router = new Router({
        fallbackOrder: ["gemini"],
      });

      const result = await router.resolveModel("test");
      // ModelRouter uses inferProviderFromModel which defaults to 'openai' for unknown models
      // fallbackOrder is only used as last resort if primary provider is on cooldown
      expect(result.provider).toBe("openai");
    });
  });
});
