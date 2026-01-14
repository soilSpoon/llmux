import { describe, expect, it, mock, afterEach, beforeEach, spyOn } from "bun:test";
import "../setup";
import { handleProxy, type ProxyOptions } from "../../src/handlers/proxy";
import { TokenRefresh, AuthProviderRegistry, OpenAIWebProvider } from "@llmux/auth";
import { rateLimitStore } from "../../src/handlers/rate-limit-store";

describe("handleProxy - Auth Fallback Integration", () => {
  const originalFetch = globalThis.fetch
  const originalEnsureFresh = TokenRefresh.ensureFresh

  beforeEach(async () => {
    TokenRefresh.ensureFresh = originalEnsureFresh
    mock.restore()
    rateLimitStore.clear()
    TokenRefresh.clearPending()
    AuthProviderRegistry.register(OpenAIWebProvider)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    TokenRefresh.ensureFresh = originalEnsureFresh
    mock.restore()
    AuthProviderRegistry.clear()
  })

  it.skip("should fallback to another provider when credentials are missing for the primary provider", async () => {
    let actualApiCallCount = 0;
    let requestedProviders: string[] = [];

    globalThis.fetch = Object.assign(
      mock(async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = url.toString();

        if (urlStr.includes("api.github.com") || urlStr.includes("raw.githubusercontent.com")) {
          return new Response(JSON.stringify({ tag_name: "v0.1.0" }), { status: 200 });
        }

        const headers = options?.headers as Record<string, string>;
        if (headers?.Authorization === "Bearer test-token") {
          actualApiCallCount++;
          return new Response(JSON.stringify({
            id: "chat-123",
            object: "chat.completion",
            created: Date.now(),
            model: "gpt-5.1",
            choices: [{ message: { role: "assistant", content: "Success from fallback" }, finish_reason: "stop", index: 0 }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        
        return new Response("Unexpected request", { status: 400 });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    spyOn(TokenRefresh, "ensureFresh").mockImplementation(async (providerId: string) => {
      requestedProviders.push(providerId);
      if (providerId === "antigravity") {
        throw new Error("No credentials available for provider: antigravity");
      }
      if (providerId === "openai-web") {
        return [{ type: "oauth", accessToken: "test-token", accountId: "test-account" } as any];
      }
      return [];
    });

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "primary-model",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    let resolveCount = 0;
    const mockRouter = {
      resolveModel: () => {
        resolveCount++;
        if (resolveCount === 1) {
          return { provider: "antigravity", model: "gemini-3-pro" };
        }
        return { provider: "openai-web", model: "gpt-5.1" };
      },
      handleRateLimit: () => {},
      handleSuccess: () => {},
      isAvailable: () => true,
      getMaxRetryAttempts: () => 5,
    };

    const options: ProxyOptions = {
      sourceFormat: "openai-chat",
      router: mockRouter as any,
    };

    const response = await handleProxy(request, options);
    
    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.choices[0].message.content).toBe("Success from fallback");
    
    expect(requestedProviders).toContain("antigravity");
    expect(requestedProviders).toContain("openai-web");
    expect(actualApiCallCount).toBe(1);
    expect(resolveCount).toBeGreaterThanOrEqual(2);
  });
});
