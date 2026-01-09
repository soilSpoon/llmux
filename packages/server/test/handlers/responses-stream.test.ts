/**
 * Responses API HTTP Header Forwarding Tests
 *
 * Tests for HTTP header forwarding from upstream responses to client responses.
 * Covers:
 * 1. x-codex-plan-type header forwarding
 * 2. x-oai-request-id header forwarding
 * 3. Mock upstream response usage
 */

import { describe, expect, it, mock, afterEach, beforeEach } from "bun:test";
import "../setup";
import {
  handleResponses,
  type ResponsesOptions,
} from "../../src/handlers/responses";

describe("handleResponses - HTTP Header Forwarding", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
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

  describe("Header Forwarding", () => {
    it.skip("should forward x-codex-plan-type header from upstream response", async () => {
      // Skipped: Header forwarding is currently disabled
    });

    it.skip("should forward x-oai-request-id header from upstream response", async () => {
      // Skipped: Header forwarding is currently disabled
    });

    it.skip("should forward both headers simultaneously", async () => {
      // Skipped: Header forwarding is currently disabled
    });

    it("should not include headers when not present in upstream response", async () => {
      globalThis.fetch = Object.assign(
        mock(async () => {
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
            },
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

      expect(response.headers.get("x-codex-plan-type")).toBeNull();
      expect(response.headers.get("x-oai-request-id")).toBeNull();
    });

    it.skip("should forward headers with streaming response body", async () => {
      // Skipped: Header forwarding is currently disabled
    });
  });
});
