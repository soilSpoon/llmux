import { describe, expect, it } from "bun:test";
import { createModelRegistry } from "../registry";
import type { Model, ModelFetcher, ModelProvider } from "../types";

describe("ModelRegistry", () => {
  describe("createModelRegistry", () => {
    it("should create a registry instance", () => {
      const registry = createModelRegistry();
      expect(registry).toBeDefined();
      expect(registry.registerFetcher).toBeFunction();
      expect(registry.getModels).toBeFunction();
    });
  });

  describe("registerFetcher", () => {
    it("should register a fetcher for a provider", () => {
      const registry = createModelRegistry();
      const mockFetcher: ModelFetcher = {
        fetchModels: async () => [],
      };

      registry.registerFetcher("antigravity", mockFetcher);
      expect(registry.hasFetcher("antigravity")).toBe(true);
    });

    it("should override existing fetcher for same provider", () => {
      const registry = createModelRegistry();
      const fetcher1: ModelFetcher = { fetchModels: async () => [] };
      const fetcher2: ModelFetcher = {
        fetchModels: async () => [
          { id: "model-1", provider: "test", name: "Model 1", object: "model" },
        ],
      };

      const testProvider = "openai" as ModelProvider;
      registry.registerFetcher(testProvider, fetcher1);
      registry.registerFetcher(testProvider, fetcher2);

      expect(registry.hasFetcher(testProvider)).toBe(true);
    });
  });

  describe("getModels", () => {
    it("should return empty array when no fetchers registered", async () => {
      const registry = createModelRegistry();
      const models = await registry.getModels(["openai"]);
      expect(models).toEqual([]);
    });

    it("should fetch models from registered provider", async () => {
      const registry = createModelRegistry();
      const expectedModels: Model[] = [
        { id: "gpt-4", provider: "openai", name: "GPT-4", object: "model" },
      ];

      registry.registerFetcher("openai", {
        fetchModels: async () => expectedModels,
      });

      const models = await registry.getModels(["openai"]);
      expect(models).toEqual(expectedModels);
    });

    it("should pass access token to fetcher", async () => {
      const registry = createModelRegistry();
      let receivedToken: string | undefined;

      registry.registerFetcher("github-copilot", {
        fetchModels: async (token) => {
          receivedToken = token;
          return [];
        },
      });

      await registry.getModels(["github-copilot"], {
        "github-copilot": "test-token-123",
      });

      expect(receivedToken).toBe("test-token-123");
    });

    it("should aggregate models from multiple providers", async () => {
      const registry = createModelRegistry();

      registry.registerFetcher("openai", {
        fetchModels: async () => [
          { id: "gpt-4", provider: "openai", name: "GPT-4", object: "model" },
        ],
      });

      registry.registerFetcher("anthropic", {
        fetchModels: async () => [
          {
            id: "claude-3",
            provider: "anthropic",
            name: "Claude 3",
            object: "model",
          },
        ],
      });

      const models = await registry.getModels(["openai", "anthropic"]);
      expect(models).toHaveLength(2);
      expect(models.map((m) => m.id)).toContain("gpt-4");
      expect(models.map((m) => m.id)).toContain("claude-3");
    });

    it("should skip providers without registered fetchers", async () => {
      const registry = createModelRegistry();

      registry.registerFetcher("openai", {
        fetchModels: async () => [
          { id: "gpt-4", provider: "openai", name: "GPT-4", object: "model" },
        ],
      });

      const models = await registry.getModels(["openai", "unknown-provider"]);
      expect(models).toHaveLength(1);
      expect(models[0]?.id).toBe("gpt-4");
    });

    it("should handle fetcher errors gracefully", async () => {
      const registry = createModelRegistry();

      registry.registerFetcher("openai", {
        fetchModels: async () => {
          throw new Error("Network error");
        },
      });

      registry.registerFetcher("anthropic", {
        fetchModels: async () => [
          {
            id: "claude-3",
            provider: "anthropic",
            name: "Claude 3",
            object: "model",
          },
        ],
      });

      const models = await registry.getModels(["openai", "anthropic"]);
      expect(models).toHaveLength(1);
      expect(models[0]?.id).toBe("claude-3");
    });
  });
});
