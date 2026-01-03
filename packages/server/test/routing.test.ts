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

    test("throws error when model not found and no mapping exists", async () => {
      const router = new Router({
        fallbackOrder: ["anthropic", "openai"],
      });

      await expect(router.resolveModel("unknown-model")).rejects.toThrow(
        "No provider found for model"
      );
    });

    test("uses explicit provider suffix", async () => {
      const router = new Router({});

      const result = await router.resolveModel("some-model:anthropic");
      expect(result.provider).toBe("anthropic");
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
    test("marks rate limit for mapped model", () => {
      const router = new Router({
        modelMapping: {
          "my-model": { provider: "anthropic", model: "claude-3" },
        },
      });

      // Should not throw - just marks cooldown
      router.handleRateLimit("my-model");
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
    test("can be instantiated with mapping", async () => {
      const router = new Router({
        modelMapping: {
          "test": { provider: "gemini", model: "gemini-pro" },
        },
      });

      const result = await router.resolveModel("test");
      expect(result.provider).toBe("gemini");
      expect(result.model).toBe("gemini-pro");
    });

    test("can use explicit provider suffix without mapping", async () => {
      const router = new Router({});

      const result = await router.resolveModel("test:openai");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("test");
    });
  });
});
