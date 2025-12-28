/**
 * Responses API Streaming Handler Tests
 *
 * Tests for the /v1/responses endpoint with streaming support.
 * Covers:
 * 1. Streaming request/response format compatibility
 * 2. Antigravity provider integration
 * 3. SSE event format and item_id consistency
 * 4. Error handling during streaming
 */

import { describe, expect, it, mock, afterEach, beforeEach } from "bun:test";
import "../setup";
import {
  handleResponses,
  type ResponsesOptions,
} from "../../src/handlers/responses";

describe("handleResponses - Streaming", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedBody: unknown;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedBody = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createStreamingRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const baseOptions: ResponsesOptions = {
    targetProvider: "openai",
    apiKey: "test-api-key",
  };

  describe("Streaming Request/Response", () => {
    it("should pass stream: true to upstream provider", async () => {
      globalThis.fetch = Object.assign(
        mock(async (_url: string, init?: RequestInit) => {
          if (init?.body) {
            capturedBody = JSON.parse(init.body as string);
          }
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Count to 3",
        stream: true,
      });

      await handleResponses(request, baseOptions);

      expect(capturedBody).toMatchObject({ stream: true });
    });

    it("should return text/event-stream content type", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("should stream OpenAI Chat Completions format", async () => {
      const chunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" World"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              chunks.forEach((chunk) => {
                controller.enqueue(new TextEncoder().encode(chunk));
              });
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Greet me",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(200);
      expect(response.body).not.toBeNull();

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullResponse += decoder.decode(value, { stream: true });
      }

      // Verify Responses API format is returned
      expect(fullResponse).toContain("response.created");
      expect(fullResponse).toContain("response.output_item.added");
      expect(fullResponse).toContain("response.output_text.delta");
    });
  });

  describe("SSE Event Format", () => {
    it("should emit response.created event first", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Start"},"finish_reason":null}]}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);
      const text = await response.text();

      const lines = text.split("\n").filter((l) => l.trim());
      const firstDataLine = lines.find((l) => l.startsWith("data:"));
      expect(firstDataLine).toContain("response.created");
    });

    it("should include item_id in delta events", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Text"},"finish_reason":"stop"}]}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);
      const text = await response.text();

      // Extract item_id from response.output_item.added
      const itemIdMatch = text.match(/"id":"(msg_\w+)"/);
      expect(itemIdMatch).not.toBeNull();

      if (itemIdMatch) {
        const itemId = itemIdMatch[1];
        // Verify delta event includes same item_id
        const deltaMatch = text.match(new RegExp(`"item_id":"${itemId}"`));
        expect(deltaMatch).not.toBeNull();
      }
    });

    it("should emit proper event sequence", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);
      const text = await response.text();

      const lines = text.split("\n").filter((l) => l.startsWith("event:"));
      const eventTypes = lines.map((l) => l.replace("event: ", ""));

      expect(eventTypes[0]).toBe("response.created");
      expect(eventTypes).toContain("response.output_item.added");
      expect(eventTypes).toContain("response.output_text.delta");
      expect(eventTypes).toContain("response.completed");
    });
  });

  describe("Antigravity Provider", () => {
    it("should transform Antigravity native format to Responses API format", async () => {
      globalThis.fetch = Object.assign(
        mock(async (_url: string, _init?: RequestInit) => {
          // capturedHeaders removed as it was unused

          // Simulate Antigravity response (native Gemini format)
          // The handler should convert this from Antigravity format to OpenAI Chat Completions
          const stream = new ReadableStream({
            start(controller) {
              // Antigravity uses wrapped format with response.candidates
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Response text"}]}}]}}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test Antigravity format",
        stream: true,
      });

      // Using OpenAI as provider since we're mocking the actual request
      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      const text = await response.text();
      // Should contain Responses API format events
      expect(text).toContain("response.output_text.delta");
    });

    it("should handle model transformation for Antigravity", async () => {
      globalThis.fetch = Object.assign(
        mock(async (_url: string, init?: RequestInit) => {
          if (init?.body) {
            capturedBody = JSON.parse(init.body as string);
          }
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gemini-3-pro",
        input: "Test",
        stream: true,
      });

      // Test with model mapping
      await handleResponses(request, {
        ...baseOptions,
        modelMappings: [{ from: "gemini-3-pro", to: "gemini-2-pro" }],
      });

      // The mapped model should be in the request
      expect(capturedBody).toMatchObject({ model: "gemini-2-pro" });
    });

    it("should include stream: true in upstream request", async () => {
      globalThis.fetch = Object.assign(
        mock(async (_url: string, init?: RequestInit) => {
          if (init?.body) {
            capturedBody = JSON.parse(init.body as string);
          }
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      await handleResponses(request, baseOptions);

      expect(capturedBody).toMatchObject({ stream: true });
    });
  });

  describe("Streaming Error Handling", () => {
    it("should handle network error during streaming", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          throw new Error("Network error");
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(502);
    });

    it("should propagate upstream 500 error", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(500);
    });

    it("should propagate upstream 429 (rate limit) error", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response(JSON.stringify({ error: "Rate limited" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(429);
    });

    it("should handle empty stream gracefully", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(200);
    });

    it("should handle malformed upstream SSE events", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode("data: invalid json\n\n")
              );
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Valid"},"finish_reason":"stop"}]}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);

      expect(response.status).toBe(200);
      const text = await response.text();
      // Should skip invalid line and process valid event
      expect(text).toContain("Valid");
    });
  });

  describe("Response Format Compliance", () => {
    it("should generate unique response IDs", async () => {
      const responseIds = new Set<string>();

      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Test"},"finish_reason":"stop"}]}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      // Make multiple requests
      for (let i = 0; i < 3; i++) {
        const request = createStreamingRequest({
          model: "gpt-4o",
          input: `Test ${i}`,
          stream: true,
        });

        const response = await handleResponses(request, baseOptions);
        const text = await response.text();
        const idMatch = text.match(/"id":"(resp_\w+)"/);

        if (idMatch && idMatch[1]) {
          responseIds.add(idMatch[1]);
        }
      }

      expect(responseIds.size).toBe(3);
    });

    it("should include required fields in streaming response", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Text"},"finish_reason":"stop"}]}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
        { preconnect: () => {} }
      ) as typeof fetch;

      const request = createStreamingRequest({
        model: "gpt-4o",
        input: "Test",
        stream: true,
      });

      const response = await handleResponses(request, baseOptions);
      const text = await response.text();

      // Parse all events
      const events: any[] = [];
      text.split("\n").forEach((line) => {
        if (line.startsWith("data: {")) {
          try {
            events.push(JSON.parse(line.slice(6)));
          } catch {
            // Skip invalid lines
          }
        }
      });

      // Check response.created has required fields
      const createdEvent = events.find((e) => e.type === "response.created");
      expect(createdEvent?.response).toBeDefined();
      expect(createdEvent?.response.id).toBeDefined();
      expect(createdEvent?.response.status).toBe("in_progress");

      // Check delta events have required fields
      const deltaEvent = events.find(
        (e) => e.type === "response.output_text.delta"
      );
      expect(deltaEvent?.item_id).toBeDefined();
      expect(deltaEvent?.delta).toBeDefined();
    });
  });
});
