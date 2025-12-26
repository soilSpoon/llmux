import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import "../../../test/setup";
import type { AmpModelMapping } from "../../config";
import { handleProxy, type ProxyOptions } from "../proxy";

describe("handleProxy with modelMappings", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedBody = undefined;
    globalThis.fetch = Object.assign(
      mock(async (_url: unknown, options?: { body?: string }) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Hello" } }],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }),
      { preconnect: () => {} }
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

      await handleProxy(request, { ...baseOptions, modelMappings: mappings });

      expect(capturedBody).toMatchObject({ model: "gemini-claude" });
    });

    it("배열 매핑일 때 첫 번째 model로 변환된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "claude", to: ["model-a", "model-b"] },
      ];
      const request = createRequest({ model: "claude", messages: [] });

      await handleProxy(request, { ...baseOptions, modelMappings: mappings });

      expect(capturedBody).toMatchObject({ model: "model-a" });
    });
  });

  describe("매핑 없음", () => {
    it("매핑이 없을 때 원본 model이 유지된다", async () => {
      const request = createRequest({ model: "gpt-4", messages: [] });

      await handleProxy(request, baseOptions);

      expect(capturedBody).toMatchObject({ model: "gpt-4" });
    });

    it("일치하는 매핑이 없을 때 원본 model이 유지된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "other-model", to: "mapped" },
      ];
      const request = createRequest({ model: "gpt-4", messages: [] });

      await handleProxy(request, { ...baseOptions, modelMappings: mappings });

      expect(capturedBody).toMatchObject({ model: "gpt-4" });
    });
  });

  describe("targetModel과의 상호작용", () => {
    it("modelMappings가 targetModel보다 먼저 적용된다", async () => {
      const mappings: AmpModelMapping[] = [
        { from: "claude-opus", to: "gemini-claude" },
      ];
      const request = createRequest({ model: "claude-opus", messages: [] });

      await handleProxy(request, {
        ...baseOptions,
        modelMappings: mappings,
        targetModel: "override-model",
      });

      expect(capturedBody).toMatchObject({ model: "override-model" });
    });
  });
});
