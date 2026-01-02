import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import "../../../test/setup";
import type { AmpModelMapping } from "../../config";
import { handleStreamingProxy, type ProxyOptions } from "../streaming";

// Helper to intentionally cast invalid data for resilience testing
function castTo<T>(data: unknown): T {
  return data as T;
}

describe("handleStreamingProxy with modelMappings", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: unknown;
  let setTimeoutSpy: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedBody = undefined;
    globalThis.fetch = Object.assign(
      mock(async (_url: unknown, options?: { body?: string }) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return new Response("data: [DONE]\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    // Mock setTimeout to resolve immediately
    setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      castTo<typeof setTimeout>((cb: (...args: any[]) => void) => {
        if (typeof cb === "function") {
          cb();
        }
        return castTo<ReturnType<typeof setTimeout>>(0);
      })
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (setTimeoutSpy) {
      setTimeoutSpy.mockRestore();
    }
  });

  function createRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const baseOptions: ProxyOptions = {
    sourceFormat: "openai",
    targetProvider: "openai",
    apiKey: "test-api-key",
  };

  describe("매핑 적용", () => {
    it("매핑이 있을 때 request body의 model이 변환된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "claude-opus", to: "gemini-claude" },
      ];
      const request = createRequest({ model: "claude-opus", messages: [] });

      await handleStreamingProxy(request, {
        ...baseOptions,
        modelMappings: mappings,
      });

      expect(capturedBody).toMatchObject({ model: "gemini-claude" });
    });

    it("배열 매핑일 때 첫 번째 model로 변환된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "claude", to: ["model-a", "model-b"] },
      ];
      const request = createRequest({ model: "claude", messages: [] });

      await handleStreamingProxy(request, {
        ...baseOptions,
        modelMappings: mappings,
      });

      expect(capturedBody).toMatchObject({ model: "model-a" });
    });
  });

  describe("매핑 없음", () => {
    it("매핑이 없을 때 원본 model이 유지된다", async () => {
      const request = createRequest({ model: "gpt-4", messages: [] });

      await handleStreamingProxy(request, baseOptions);

      expect(capturedBody).toMatchObject({ model: "gpt-4" });
    });

    it("일치하는 매핑이 없을 때 원본 model이 유지된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "other-model", to: "mapped" },
      ];
      const request = createRequest({ model: "gpt-4", messages: [] });

      await handleStreamingProxy(request, {
        ...baseOptions,
        modelMappings: mappings,
      });

      expect(capturedBody).toMatchObject({ model: "gpt-4" });
    });
  });

  describe("targetModel과의 상호작용", () => {
    it("modelMappings가 targetModel보다 먼저 적용된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "claude-opus", to: "gemini-claude" },
      ];
      const request = createRequest({ model: "claude-opus", messages: [] });

      await handleStreamingProxy(request, {
        ...baseOptions,
        modelMappings: mappings,
        targetModel: "override-model",
      });

      expect(capturedBody).toMatchObject({ model: "override-model" });
    });
  });

  describe("Provider Specific Options", () => {
    it("openai provider receives model in request body", async () => {
      const request = createRequest({ model: "gpt-4", messages: [] });
      await handleStreamingProxy(request, {
        ...baseOptions,
        targetProvider: "openai",
      });

      // Verify that the request was made with the correct model
      expect(capturedBody).toMatchObject({
        model: "gpt-4",
      });
    });

    it("other providers do not receive stream_options", async () => {
      // Mock getProvider to avoid "Unknown provider" error for fallback logic if needed
      // But here we rely on basic flow. Anthropic doesn't use stream_options.
      const request = createRequest({
        model: "claude-3-5-sonnet",
        messages: [],
      });
      await handleStreamingProxy(request, {
        ...baseOptions,
        sourceFormat: "anthropic",
        targetProvider: "anthropic",
      });

      expect(capturedBody).not.toHaveProperty("stream_options");
    });
  });
});
