import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import "../../../test/setup";
import { handleStreamingProxy, type ProxyOptions } from "../streaming";
import { TokenRefresh } from '@llmux/auth'

describe("handleStreamingProxy model fallback", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: any;
  let tokenRefreshSpy: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    
    // Mock TokenRefresh.ensureFresh to return a single dummy credential
    // This ensures we have 1 account.
    // When we get 429, we mark it rate limited.
    // Then areAllRateLimited check sees 1 account, 1 rate limited -> TRUE.
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

  const baseOptions: ProxyOptions = {
    sourceFormat: "openai",
    targetProvider: "antigravity", // Use antigravity to trigger rotation logic
    apiKey: "test-api-key",
  };

  it("should fallback to gemini-3-pro-high when gemini-claude-opus-4-5-thinking is rate limited", async () => {
    const request = createRequest({ model: "gemini-claude-opus-4-5-thinking", messages: [] });

    // Mock hasNext to eventually return false to simulate all accounts exhausted
    // However, the real implementation checks accountRotationManager.
    // We can assume strict mocking of the module if checking unit isolation, 
    // but here we are doing integration-like test with real handler.
    // The handler throws "Max attempts reached" when retries invoke and fail.
    
    // We rely on the fact that without our fix, it won't switch models.
    const response = await handleStreamingProxy(request, baseOptions);
    if (response.status !== 200) {
        console.error(await response.text());
    }
    expect(response.status).toBe(200);
  });
});
