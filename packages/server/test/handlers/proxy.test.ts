import {
  describe,
  expect,
  test,
  mock,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";
import "../setup";
import { handleProxy, type ProxyOptions } from "../../src/handlers/proxy";

// Helper to intentionally cast invalid data for resilience testing
function castTo<T>(data: unknown): T {
  return data as T;
}

describe("handleProxy", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = Object.assign(
      mock(async (_url: string | URL | Request) => {
        return new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello from mock" }],
            model: "claude-3-sonnet-20240229",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }),
      { preconnect: () => {} }
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("transforms OpenAI request to Anthropic", async () => {
    const body = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };
    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      targetModel: "claude-3-sonnet-20240229",
      apiKey: "test-api-key",
    };

    const response = await handleProxy(request, options);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("uses apiKey in Authorization header", async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = Object.assign(
      mock(
        async (
          _url: string | URL | Request,
          init?: RequestInit
        ): Promise<Response> => {
          if (init?.headers) {
            capturedHeaders = new Headers(init.headers);
          }
          return new Response(
            JSON.stringify({
              id: "msg_123",
              type: "message",
              role: "assistant",
              content: [{ type: "text", text: "Hello" }],
              model: "claude-3-sonnet-20240229",
              stop_reason: "end_turn",
              usage: { input_tokens: 10, output_tokens: 5 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      ),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "my-secret-key",
    };

    await handleProxy(request, options);

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("x-api-key")).toBe("my-secret-key");
  });

  test("returns error response on upstream failure", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(
          JSON.stringify({ error: { message: "Bad request" } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleProxy(request, options);
    expect(response.status).toBe(400);
  });

  test("retries with backoff on 429 and eventually returns error", async () => {
    // Mock setTimeout to resolve immediately
    const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      castTo<typeof setTimeout>((cb: (...args: any[]) => void) => {
        if (typeof cb === "function") {
          cb();
        }
        return castTo<ReturnType<typeof setTimeout>>(0);
      })
    );

    let callCount = 0;
    globalThis.fetch = Object.assign(
      mock(async () => {
        callCount++;
        return new Response(
          JSON.stringify({ error: { message: "Rate limited" } }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleProxy(request, options);
    expect(response.status).toBe(429);
    expect(callCount).toBe(5);

    setTimeoutSpy.mockRestore();
  }, 2000);

  test("handles non-JSON error response gracefully", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleProxy(request, options);
    expect(response.status).toBe(502);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("<html>Bad Gateway</html>");
  });

  test("handles network errors", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        throw new Error("Network error");
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleProxy(request, options);
    expect(response.status).toBe(502);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("Network error");
  });

  test("transforms response back to source format", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(
          JSON.stringify({
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello from Anthropic" }],
            model: "claude-3-sonnet-20240229",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleProxy(request, options);
    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    expect(data.choices).toBeDefined();
    expect(data.choices[0]?.message.content).toBe("Hello from Anthropic");
  });
});
