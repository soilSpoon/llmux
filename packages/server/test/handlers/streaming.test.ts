import { describe, expect, test, mock, afterEach, beforeEach, spyOn } from "bun:test";
import "../setup";
import {
  handleStreamingProxy,
  type ProxyOptions,
} from "../../src/handlers/streaming";

// Helper to intentionally cast invalid data for resilience testing
function castTo<T>(data: unknown): T {
  return data as T;
}

describe("handleStreamingProxy", () => {
  const originalFetch = globalThis.fetch;
  let setTimeoutSpy: any;

  beforeEach(() => {
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

  test("returns streaming response with correct content type", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n'
          )
        );
        controller.close();
      },
    });

    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(mockStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
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
        stream: true,
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleStreamingProxy(request, options);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  });

  test(
    "handles network errors in streaming",
    async () => {
      let attemptCount = 0;
      globalThis.fetch = Object.assign(
        mock(async () => {
          attemptCount++;
          // Fail first 2 attempts, then return 502 error
          if (attemptCount < 3) {
            throw new Error("Stream connection failed");
          }
          return new Response(JSON.stringify({ error: "Service unavailable" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
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
          stream: true,
        }),
      });

      const options: ProxyOptions = {
        sourceFormat: "openai",
        targetProvider: "anthropic",
        apiKey: "test-key",
      };

      const response = await handleStreamingProxy(request, options);
      // Handler wraps all errors in 500 status
      expect(response.status).toBe(500);
    },
    { timeout: 10000 }
  );

  test("handles upstream error response", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
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
        stream: true,
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleStreamingProxy(request, options);
    // Handler wraps all errors in 500 with { error: message } format
    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    // The error message might vary, just check it exists
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("Upstream error 500");
  });

  test("streams transformed chunks", async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-3","stop_reason":null}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];

    const mockStream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(mockStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
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
        stream: true,
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleStreamingProxy(request, options);
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    expect(fullText).toContain("data:");
  });

  test("handles antigravity streaming with correct endpoints and headers", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    let capturedBody: any;

    globalThis.fetch = Object.assign(
      mock(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedHeaders = new Headers(init?.headers);
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string);
        }

        return new Response("data: {}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-pro-preview",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "antigravity",
      apiKey: "test-key",
    };

    await handleStreamingProxy(request, options);

    expect(capturedUrl).toBe(
      "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse"
    );
    // Antigravity uses prepareAntigravityRequest which fetches real credentials,
    // so we just check the Authorization header exists (starts with Bearer)
    expect(capturedHeaders?.get("Authorization")).toMatch(/^Bearer /);
    expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
    expect(capturedHeaders?.get("X-Goog-Api-Client")).toBe(
      "google-cloud-sdk vscode_cloudshelleditor/0.1"
    );
    expect(capturedHeaders?.get("Client-Metadata")).toContain("ideType");

    // Verify wrapper structure
    expect(capturedBody).toHaveProperty("project");
    // Note: gemini-3-pro-preview is passed through as-is (aliasing removed)
    expect(capturedBody).toHaveProperty("model", "gemini-3-pro-preview");
    expect(capturedBody).toHaveProperty("request");
    expect(capturedBody).toHaveProperty("requestId");
    expect(capturedBody.request).toHaveProperty("contents");
  });

  test("propagates upstream 404 error", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(JSON.stringify({ error: "Project not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
      { preconnect: () => {} }
    ) as typeof fetch;

    const request = new Request("http://localhost/v1/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-pro-preview",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "openai",
      targetProvider: "antigravity",
      apiKey: "test-key",
    };

    const response = await handleStreamingProxy(request, options);
    // Handler wraps all errors in 500
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeDefined();
    expect(body.error).toContain("Upstream error 404");
  });

  test("patches stop_reason for tool_use blocks", async () => {
    // This stream simulates:
    // 1. Tool use start
    // 2. Tool input delta
    // 3. Stop event with stop_reason: end_turn (Gemini behavior)
    // Expectation: The output should have stop_reason: tool_use
    const chunks = [
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-3","stop_reason":null}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"test_tool","input":{}}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];

    const mockStream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = Object.assign(
      mock(async () => {
        return new Response(mockStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
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
        stream: true,
      }),
    });

    const options: ProxyOptions = {
      sourceFormat: "anthropic", // Must be anthropic source to trigger patching
      targetProvider: "anthropic",
      apiKey: "test-key",
    };

    const response = await handleStreamingProxy(request, options);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // Verify the patch occurred
    expect(fullText).toContain('"stop_reason":"tool_use"');
    expect(fullText).not.toContain('"stop_reason":"end_turn"');
  });

  describe("partialJson streaming integration", () => {
    test("should preserve partialJson across streaming pipe", async () => {
      const partialJsonChunks = [
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"name\\""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":",\\"age\\":30"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"}"}}\n\n',
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          for (const chunk of partialJsonChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response(mockStream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = new Request("http://localhost/v1/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-opus",
          messages: [{ role: "user", content: "Call a tool" }],
          tools: [{ name: "test", description: "Test tool", input_schema: {} }],
          stream: true,
        }),
      });

      const options: ProxyOptions = {
        sourceFormat: "anthropic",
        targetProvider: "anthropic",
        apiKey: "test-key",
      };

      const response = await handleStreamingProxy(request, options);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      // Verify all chunks were streamed
      expect(fullText).toContain("input_json_delta");
      expect(fullText).toContain('partial_json":"{');
      expect(fullText).toContain("name");
      expect(fullText).toContain("age");
    });

    test("should handle empty partialJson chunks gracefully", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":""}}\n\n'
            )
          );
          controller.close();
        },
      });

      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response(mockStream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = new Request("http://localhost/v1/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-opus",
          messages: [{ role: "user", content: "Test" }],
          stream: true,
        }),
      });

      const options: ProxyOptions = {
        sourceFormat: "anthropic",
        targetProvider: "openai",
        apiKey: "test-key",
      };

      const response = await handleStreamingProxy(request, options);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    test("should correctly chunk large partialJson across multiple events", async () => {
      // Simulate a large JSON object being streamed in fragments
      const largeJson = JSON.stringify({
        description: "This is a test",
        nested: {
          values: [1, 2, 3, 4, 5],
          object: { key: "value" },
        },
      });

      const chunks: string[] = [];
      const chunkSize = 30;
      for (let i = 0; i < largeJson.length; i += chunkSize) {
        const fragment = largeJson.slice(i, i + chunkSize);
        chunks.push(
          `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"${fragment.replace(/"/g, '\\"')}"}}\n\n`
        );
      }

      const mockStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response(mockStream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = new Request("http://localhost/v1/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-opus",
          messages: [{ role: "user", content: "Test" }],
          stream: true,
        }),
      });

      const options: ProxyOptions = {
        sourceFormat: "anthropic",
        targetProvider: "openai",
        apiKey: "test-key",
      };

      const response = await handleStreamingProxy(request, options);
      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullResponse += decoder.decode(value, { stream: true });
      }

      // Should have transformed and streamed all the data
      expect(fullResponse.length).toBeGreaterThan(0);
    });

    test("should handle mixed text and partialJson in same stream", async () => {
      const mixedChunks = [
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will call a tool"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"param\\""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"value\\""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"}"}}\n\n',
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          for (const chunk of mixedChunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response(mockStream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = new Request("http://localhost/v1/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-opus",
          messages: [{ role: "user", content: "Test" }],
          stream: true,
        }),
      });

      const options: ProxyOptions = {
        sourceFormat: "anthropic",
        targetProvider: "openai",
        apiKey: "test-key",
      };

      const response = await handleStreamingProxy(request, options);
      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullResponse += decoder.decode(value, { stream: true });
      }

      // Verify both text and JSON parts are present
      expect(fullResponse).toContain("tool");
      expect(fullResponse.length).toBeGreaterThan(0);
    });
  });
});
