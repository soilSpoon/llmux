import { describe, expect, test, mock, afterEach } from "bun:test";
import "../setup";
import {
  handleStreamingProxy,
  type ProxyOptions,
} from "../../src/handlers/streaming";

describe("handleStreamingProxy", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

  test("handles network errors in streaming", async () => {
    globalThis.fetch = Object.assign(
      mock(async () => {
        throw new Error("Stream connection failed");
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
    expect(response.status).toBe(502);
  });

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
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Rate limited" });
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
    expect(capturedHeaders?.get("Authorization")).toBe("Bearer test-key");
    expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
    expect(capturedHeaders?.get("X-Goog-Api-Client")).toBe(
      "google-cloud-sdk vscode_cloudshelleditor/0.1"
    );
    expect(capturedHeaders?.get("Client-Metadata")).toContain("ideType");

    // Verify wrapper structure
    expect(capturedBody).toHaveProperty("project");
    // Note: gemini-3-pro-preview is aliased to gemini-3-pro-high by ANTIGRAVITY_MODEL_ALIASES
    expect(capturedBody).toHaveProperty("model", "gemini-3-pro-high");
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
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Project not found");
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
});
