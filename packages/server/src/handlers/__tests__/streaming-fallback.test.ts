import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import "../../../test/setup";
import { handleStreamingProxy, type ProxyOptions } from "../streaming";
import { TokenRefresh } from '@llmux/auth'
import { Router } from "../../routing";

describe("handleStreamingProxy model fallback", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: any;
  let tokenRefreshSpy: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    
    tokenRefreshSpy = spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([{
       accessToken: 'mock',
       refreshToken: 'mock', 
       expiresAt: Date.now() + 3600000 
    } as any]);
    
    fetchMock = mock(async (_url: unknown, options?: { body?: string }) => {
        if (options?.body) {
            const body = JSON.parse(options.body);
            if (body.model === 'gemini-3-pro-high') {
                 return new Response("data: [DONE]\n", {
                  headers: { "Content-Type": "text/event-stream" },
                });
            }
        }
        return new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
    });

    globalThis.fetch = Object.assign(fetchMock, { preconnect: () => {} }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenRefreshSpy.mockRestore();
  });

  function createRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("should fallback to gemini-3-pro-high when primary model is rate limited", async () => {
    const router = new Router({
      modelMapping: {
        "gemini-claude-opus-4-5-thinking": {
          provider: "antigravity",
          model: "gemini-claude-opus-4-5-thinking",
          fallbacks: ["gemini-3-pro-high"],
        },
        "gemini-3-pro-high": {
          provider: "antigravity",
          model: "gemini-3-pro-high",
        },
      },
    });

    const baseOptions: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "antigravity",
      apiKey: "test-api-key",
      router,
    };

    const request = createRequest({ model: "gemini-claude-opus-4-5-thinking", messages: [] });
    
    const response = await handleStreamingProxy(request, baseOptions);
    if (response.status !== 200) {
        console.error(await response.text());
    }
    expect(response.status).toBe(200);
  });
});
