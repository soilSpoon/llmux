import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import "../../../test/setup";
import type { ModelMapping } from "../../config";
import { handleProxy, type ProxyOptions } from "../proxy";

describe("handleProxy with modelMappings", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedBody = undefined;
    globalThis.fetch = Object.assign(
      mock(async (input: Request | unknown, options?: { body?: string }) => {
        if (input instanceof Request) {
          const cloned = input.clone();
          try {
            capturedBody = await cloned.json();
          } catch {
            // Ignore parse errors
          }
        } else if (options?.body) {
          try {
            capturedBody = JSON.parse(options.body);
          } catch {
            // Ignore parse errors
          }
        }
        return new Response(
          JSON.stringify({
            id: "chatcmpl-123",
            object: "chat.completion",
            created: 1234567890,
            model: "gpt-4",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello" },
                finish_reason: "stop",
              },
            ],
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
      body: JSON.stringify({ provider: "openai", ...body }), // Explicitly add provider for tests
    });
  }

  const baseOptions: ProxyOptions = {
    sourceFormat: "openai-chat",
    targetProvider: "openai",
    apiKey: "test-api-key",
  };

  describe("매핑 적용", () => {
    it("매핑이 있을 때 request body의 model이 변환된다", async () => {
      const mappings: ModelMapping[] = [
        { from: "claude-opus", to: "gemini-claude" },
      ];
      const request = createRequest({ model: "claude-opus", messages: [] });

      await handleProxy(request, { ...baseOptions, modelMappings: mappings });

      expect(capturedBody).toMatchObject({
        model: "gemini-claude",
        messages: [],
        reasoning_effort: "none",
      });
    });

    it("배열 매핑일 때 첫 번째 model로 변환된다", async () => {
      const mappings: ModelMapping[] = [
        { from: "claude", to: ["model-a", "model-b"] },
      ];
      const request = createRequest({ model: "claude", messages: [] });

      await handleProxy(request, { ...baseOptions, modelMappings: mappings });

      expect(capturedBody).toMatchObject({
        model: "model-a",
        messages: [],
        reasoning_effort: "none",
      });
    });
  });

  describe("매핑 없음", () => {
    it("매핑이 없을 때 원본 model이 유지된다", async () => {
      const request = createRequest({ model: "gpt-4", messages: [] });

      await handleProxy(request, baseOptions);

      expect(capturedBody).toMatchObject({
        model: "gpt-4",
        messages: [],
        reasoning_effort: "none",
      });
    });

    it("일치하는 매핑이 없을 때 원본 model이 유지된다", async () => {
      const mappings: ModelMapping[] = [
        { from: "other-model", to: "mapped" },
      ];
      const request = createRequest({ model: "gpt-4", messages: [] });

      await handleProxy(request, { ...baseOptions, modelMappings: mappings });

      expect(capturedBody).toMatchObject({
        model: "gpt-4",
        messages: [],
        reasoning_effort: "none",
      });
    });
  });

  describe("targetModel과의 상호작용", () => {
    it("modelMappings가 targetModel보다 먼저 적용된다", async () => {
      const mappings: ModelMapping[] = [
        { from: "claude-opus", to: "gemini-claude" },
      ];
      const request = createRequest({ model: "claude-opus", messages: [] });

      await handleProxy(request, {
        ...baseOptions,
        modelMappings: mappings,
        targetModel: "override-model",
      });

      expect(capturedBody).toMatchObject({
        model: "override-model",
        messages: [],
        reasoning_effort: "none",
      });
    });
  });
});
