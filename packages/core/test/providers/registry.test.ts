import { describe, expect, it, beforeEach } from "bun:test";
import {
  getProvider,
  registerProvider,
  hasProvider,
  getRegisteredProviders,
  clearProviders,
} from "../../src/providers/registry";
import {
  BaseProvider,
  type ProviderConfig,
  type ProviderName,
} from "../../src/providers/base";
import type {
  StreamChunk,
  UnifiedRequest,
  UnifiedResponse,
} from "../../src/types/unified";

class MockProvider extends BaseProvider {
  readonly name: ProviderName = "openai";
  readonly config: ProviderConfig = {
    name: "openai",
    supportsStreaming: true,
    supportsThinking: false,
    supportsTools: true,
  };

  isSupportedRequest(_request: unknown): boolean {
    return true;
  }

  isSupportedModel(_model: string): boolean {
    return true;
  }

  parse(_request: unknown): UnifiedRequest {
    return { messages: [] };
  }

  transform(_request: UnifiedRequest): unknown {
    return {};
  }

  parseResponse(_response: unknown): UnifiedResponse {
    return { id: "mock", content: [], stopReason: null };
  }

  transformResponse(_response: UnifiedResponse): unknown {
    return {};
  }

  parseStreamChunk(_chunk: string): StreamChunk | null {
    return null;
  }

  transformStreamChunk(_chunk: StreamChunk): string {
    return "";
  }
}

class CustomMockProvider extends MockProvider {
  override readonly name: ProviderName = "anthropic";
  override readonly config: ProviderConfig = {
    name: "anthropic",
    supportsStreaming: true,
    supportsThinking: true,
    supportsTools: true,
  };
}

describe("Provider Registry", () => {
  beforeEach(() => {
    clearProviders();
  });

  describe("registerProvider", () => {
    it("should register a provider", () => {
      const provider = new MockProvider();
      registerProvider(provider);

      expect(hasProvider("openai")).toBe(true);
    });

    it("should override existing provider with same name", () => {
      const provider1 = new MockProvider();
      const provider2 = new MockProvider();

      registerProvider(provider1);
      registerProvider(provider2);

      const retrieved = getProvider("openai");
      expect(retrieved).toBe(provider2);
    });

    it("should register multiple different providers", () => {
      const openaiProvider = new MockProvider();
      const anthropicProvider = new CustomMockProvider();

      registerProvider(openaiProvider);
      registerProvider(anthropicProvider);

      expect(hasProvider("openai")).toBe(true);
      expect(hasProvider("anthropic")).toBe(true);
    });
  });

  describe("getProvider", () => {
    it("should return registered provider", () => {
      const provider = new MockProvider();
      registerProvider(provider);

      const retrieved = getProvider("openai");

      expect(retrieved).toBe(provider);
      expect(retrieved.name).toBe("openai");
    });

    it("should throw error for unregistered provider", () => {
      expect(() => getProvider("openai")).toThrow(
        'Provider "openai" not registered'
      );
    });

    it("should throw error with provider name in message", () => {
      expect(() => getProvider("anthropic")).toThrow("anthropic");
    });
  });

  describe("hasProvider", () => {
    it("should return true for registered provider", () => {
      registerProvider(new MockProvider());

      expect(hasProvider("openai")).toBe(true);
    });

    it("should return false for unregistered provider", () => {
      expect(hasProvider("openai")).toBe(false);
      expect(hasProvider("anthropic")).toBe(false);
      expect(hasProvider("gemini")).toBe(false);
    });

    it("should return false after provider is cleared", () => {
      registerProvider(new MockProvider());
      expect(hasProvider("openai")).toBe(true);

      clearProviders();
      expect(hasProvider("openai")).toBe(false);
    });
  });

  describe("getRegisteredProviders", () => {
    it("should return empty array when no providers registered", () => {
      const providers = getRegisteredProviders();

      expect(providers).toEqual([]);
    });

    it("should return all registered provider names", () => {
      registerProvider(new MockProvider());
      registerProvider(new CustomMockProvider());

      const providers = getRegisteredProviders();

      expect(providers).toContain("openai");
      expect(providers).toContain("anthropic");
      expect(providers).toHaveLength(2);
    });

    it("should not include duplicate names", () => {
      registerProvider(new MockProvider());
      registerProvider(new MockProvider());

      const providers = getRegisteredProviders();

      expect(providers).toHaveLength(1);
      expect(providers).toEqual(["openai"]);
    });
  });

  describe("clearProviders", () => {
    it("should remove all registered providers", () => {
      registerProvider(new MockProvider());
      registerProvider(new CustomMockProvider());

      expect(getRegisteredProviders()).toHaveLength(2);

      clearProviders();

      expect(getRegisteredProviders()).toHaveLength(0);
      expect(hasProvider("openai")).toBe(false);
      expect(hasProvider("anthropic")).toBe(false);
    });

    it("should allow re-registration after clear", () => {
      registerProvider(new MockProvider());
      clearProviders();
      registerProvider(new MockProvider());

      expect(hasProvider("openai")).toBe(true);
      expect(getRegisteredProviders()).toHaveLength(1);
    });
  });

  describe("custom provider implementation", () => {
    it("should work with minimal provider implementation", () => {
      class MinimalProvider extends BaseProvider {
        readonly name: ProviderName = "gemini";
        readonly config: ProviderConfig = {
          name: "gemini",
          supportsStreaming: false,
          supportsThinking: false,
          supportsTools: false,
        };

        isSupportedRequest(_request: unknown): boolean {
          return true;
        }

        isSupportedModel(_model: string): boolean {
          return true;
        }

        parse(): UnifiedRequest {
          return {
            messages: [
              { role: "user", parts: [{ type: "text", text: "test" }] },
            ],
          };
        }
        transform(): unknown {
          return { contents: [] };
        }
        parseResponse(): UnifiedResponse {
          return {
            id: "test",
            content: [{ type: "text", text: "response" }],
            stopReason: "end_turn",
          };
        }
        transformResponse(): unknown {
          return { candidates: [] };
        }
      }

      const provider = new MinimalProvider();
      registerProvider(provider);

      const retrieved = getProvider("gemini");
      expect(retrieved.name).toBe("gemini");
      expect(retrieved.config.supportsStreaming).toBe(false);

      const parsed = retrieved.parse({});
      expect(parsed.messages[0]!.parts[0]!.text).toBe("test");
    });

    it("should preserve provider methods", () => {
      const provider = new MockProvider();
      registerProvider(provider);

      const retrieved = getProvider("openai");

      expect(typeof retrieved.parse).toBe("function");
      expect(typeof retrieved.transform).toBe("function");
      expect(typeof retrieved.parseResponse).toBe("function");
      expect(typeof retrieved.transformResponse).toBe("function");
      expect(typeof retrieved.parseStreamChunk).toBe("function");
      expect(typeof retrieved.transformStreamChunk).toBe("function");
    });
  });
});
