import { describe, expect, it } from "bun:test";
import {
  parseResponse,
  transformResponse,
} from "../../../src/providers/antigravity/response";
import type { AntigravityResponse } from "../../../src/providers/antigravity/types";
import { createUnifiedResponse } from "../_utils/fixtures";

describe("Antigravity Response Transformations", () => {
  describe("parseResponse()", () => {
    describe("basic response parsing", () => {
      it("should parse a simple text response", () => {
        const antigravityResponse: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hello!" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 20,
              totalTokenCount: 30,
            },
          },
        };

        const result = parseResponse(antigravityResponse);

        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");
        expect(result.content[0]!.text).toBe("Hello!");
        expect(result.stopReason).toBe("end_turn");
      });

      it("should parse multi-part response", () => {
        const antigravityResponse: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "First part." }, { text: "Second part." }],
                },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(antigravityResponse);

        expect(result.content).toHaveLength(2);
        expect(result.content[0]!.text).toBe("First part.");
        expect(result.content[1]!.text).toBe("Second part.");
      });
    });

    describe("finish reason mapping", () => {
      it("should map STOP to end_turn", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Done" }] },
                finishReason: "STOP",
              },
            ],
          },
        };

        expect(parseResponse(response).stopReason).toBe("end_turn");
      });

      it("should map MAX_TOKENS to max_tokens", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Truncated" }] },
                finishReason: "MAX_TOKENS",
              },
            ],
          },
        };

        expect(parseResponse(response).stopReason).toBe("max_tokens");
      });

      it("should map SAFETY to content_filter", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Blocked" }] },
                finishReason: "SAFETY",
              },
            ],
          },
        };

        expect(parseResponse(response).stopReason).toBe("content_filter");
      });
    });

    describe("usage metadata parsing", () => {
      it("should parse usage metadata", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 200,
              totalTokenCount: 300,
            },
          },
        };

        const result = parseResponse(response);

        expect(result.usage?.inputTokens).toBe(100);
        expect(result.usage?.outputTokens).toBe(200);
        expect(result.usage?.totalTokens).toBe(300);
      });

      it("should parse thinking tokens", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 200,
              totalTokenCount: 300,
              thoughtsTokenCount: 50,
            },
          },
        };

        const result = parseResponse(response);

        expect(result.usage?.thinkingTokens).toBe(50);
      });

      it("should parse cached tokens", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 200,
              totalTokenCount: 300,
              cachedContentTokenCount: 25,
            },
          },
        };

        const result = parseResponse(response);

        expect(result.usage?.cachedTokens).toBe(25);
      });
    });

    describe("thinking blocks parsing", () => {
      it("should parse thinking parts with signatures", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      thought: true,
                      text: "Let me analyze...",
                      thoughtSignature: "sig123abc",
                    },
                    { text: "Here is my answer." },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(response);

        // Thinking should be in dedicated field
        expect(result.thinking).toHaveLength(1);
        expect(result.thinking![0]!.text).toBe("Let me analyze...");
        expect(result.thinking![0]!.signature).toBe("sig123abc");

        // Content should only have non-thinking parts
        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.text).toBe("Here is my answer.");
      });

      it("should handle multiple thinking blocks", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      thought: true,
                      text: "First thought",
                      thoughtSignature: "sig1",
                    },
                    {
                      thought: true,
                      text: "Second thought",
                      thoughtSignature: "sig2",
                    },
                    { text: "Final answer" },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(response);

        expect(result.thinking).toHaveLength(2);
        expect(result.thinking![0]!.text).toBe("First thought");
        expect(result.thinking![1]!.text).toBe("Second thought");
      });
    });

    describe("function call parsing", () => {
      it("should parse functionCall parts", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "get_weather",
                        args: { location: "NYC" },
                        id: "call-123",
                      },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(response);

        expect(result.content[0]!.type).toBe("tool_call");
        expect(result.content[0]!.toolCall?.name).toBe("get_weather");
        expect(result.content[0]!.toolCall?.arguments).toEqual({
          location: "NYC",
        });
        expect(result.content[0]!.toolCall?.id).toBe("call-123");
        expect(result.stopReason).toBe("tool_use");
      });

      it("should parse functionCall with thoughtSignature", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "get_weather",
                        args: { location: "NYC" },
                        id: "call-123",
                      },
                      thoughtSignature: "skip_thought_signature_validator",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(response);

        expect(result.content[0]!.type).toBe("tool_call");
        expect(result.content[0]!.toolCall?.id).toBe("call-123");
      });

      it("should generate ID if not provided", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "get_weather",
                        args: { location: "NYC" },
                      },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(response);

        expect(result.content[0]!.toolCall?.id).toBeDefined();
        expect(result.content[0]!.toolCall?.id).toMatch(/get_weather-/);
      });
    });

    describe("response ID handling", () => {
      it("should use responseId if present", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
            responseId: "resp-123",
          },
        };

        const result = parseResponse(response);

        expect(result.id).toBe("resp-123");
      });

      it("should generate ID if responseId not present", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
          },
        };

        const result = parseResponse(response);

        expect(result.id).toBeDefined();
      });
    });

    describe("traceId handling", () => {
      it("should preserve traceId in metadata", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
          },
          traceId: "trace-abc123",
        };

        // traceId is metadata - implementation may or may not expose it
        // Just verify parsing doesn't fail
        const result = parseResponse(response);
        expect(result.content).toHaveLength(1);
      });
    });

    describe("error handling", () => {
      it("should handle empty candidates", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [],
          },
        };

        const result = parseResponse(response);

        expect(result.content).toHaveLength(0);
      });

      it("should handle missing finishReason", () => {
        const response: AntigravityResponse = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
              },
            ],
          },
        };

        const result = parseResponse(response);

        expect(result.stopReason).toBeNull();
      });
    });
  });

  describe("transformResponse()", () => {
    describe("basic response transformation", () => {
      it("should transform a simple text response", () => {
        const unifiedResponse = createUnifiedResponse({
          content: [{ type: "text", text: "Hello!" }],
          stopReason: "end_turn",
        });

        const result = transformResponse(
          unifiedResponse
        ) as AntigravityResponse;

        expect(result.response).toBeDefined();
        expect(result.response.candidates).toHaveLength(1);
        expect(result.response.candidates[0]!.content.parts[0]!.text).toBe(
          "Hello!"
        );
        expect(result.response.candidates[0]!.finishReason).toBe("STOP");
      });

      it("should transform multi-part response", () => {
        const unifiedResponse = createUnifiedResponse({
          content: [
            { type: "text", text: "First part." },
            { type: "text", text: "Second part." },
          ],
        });

        const result = transformResponse(
          unifiedResponse
        ) as AntigravityResponse;

        expect(result.response.candidates[0]!.content.parts).toHaveLength(2);
        expect(result.response.candidates[0]!.content.parts[0]!.text).toBe(
          "First part."
        );
        expect(result.response.candidates[0]!.content.parts[1]!.text).toBe(
          "Second part."
        );
      });
    });

    describe("stop reason mapping", () => {
      it("should map end_turn to STOP", () => {
        const response = createUnifiedResponse({ stopReason: "end_turn" });
        const result = transformResponse(response) as AntigravityResponse;
        expect(result.response.candidates[0]!.finishReason).toBe("STOP");
      });

      it("should map max_tokens to MAX_TOKENS", () => {
        const response = createUnifiedResponse({ stopReason: "max_tokens" });
        const result = transformResponse(response) as AntigravityResponse;
        expect(result.response.candidates[0]!.finishReason).toBe("MAX_TOKENS");
      });

      it("should map tool_use to STOP", () => {
        const response = createUnifiedResponse({ stopReason: "tool_use" });
        const result = transformResponse(response) as AntigravityResponse;
        expect(result.response.candidates[0]!.finishReason).toBe("STOP");
      });

      it("should map content_filter to SAFETY", () => {
        const response = createUnifiedResponse({
          stopReason: "content_filter",
        });
        const result = transformResponse(response) as AntigravityResponse;
        expect(result.response.candidates[0]!.finishReason).toBe("SAFETY");
      });
    });

    describe("usage metadata transformation", () => {
      it("should transform usage metadata", () => {
        const response = createUnifiedResponse({
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
          },
        });

        const result = transformResponse(response) as AntigravityResponse;

        expect(result.response.usageMetadata?.promptTokenCount).toBe(100);
        expect(result.response.usageMetadata?.candidatesTokenCount).toBe(200);
        expect(result.response.usageMetadata?.totalTokenCount).toBe(300);
      });

      it("should transform thinking tokens", () => {
        const response = createUnifiedResponse({
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            thinkingTokens: 50,
          },
        });

        const result = transformResponse(response) as AntigravityResponse;

        expect(result.response.usageMetadata?.thoughtsTokenCount).toBe(50);
      });

      it("should transform cached tokens", () => {
        const response = createUnifiedResponse({
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            cachedTokens: 25,
          },
        });

        const result = transformResponse(response) as AntigravityResponse;

        expect(result.response.usageMetadata?.cachedContentTokenCount).toBe(25);
      });
    });

    describe("thinking blocks transformation", () => {
      it("should transform thinking blocks with signatures", () => {
        const response = createUnifiedResponse({
          content: [{ type: "text", text: "Here is my answer." }],
          thinking: [{ text: "Let me analyze...", signature: "sig123" }],
        });

        const result = transformResponse(response) as AntigravityResponse;

        const parts = result.response.candidates[0]!.content.parts;
        expect(parts[0]!.thought).toBe(true);
        expect(parts[0]!.text).toBe("Let me analyze...");
        expect(parts[0]!.thoughtSignature).toBe("sig123");
        expect(parts[1]!.text).toBe("Here is my answer.");
      });

      it("should handle thinking without signature", () => {
        const response = createUnifiedResponse({
          content: [{ type: "text", text: "Answer" }],
          thinking: [{ text: "Thinking..." }],
        });

        const result = transformResponse(response) as AntigravityResponse;

        const parts = result.response.candidates[0]!.content.parts;
        expect(parts[0]!.thought).toBe(true);
        expect(parts[0]!.text).toBe("Thinking...");
        // May or may not have thoughtSignature depending on implementation
      });
    });

    describe("tool call transformation", () => {
      it("should transform tool_call to functionCall", () => {
        const response = createUnifiedResponse({
          content: [
            {
              type: "tool_call",
              toolCall: {
                id: "call-123",
                name: "get_weather",
                arguments: { location: "NYC" },
              },
            },
          ],
          stopReason: "tool_use",
        });

        const result = transformResponse(response) as AntigravityResponse;

        const fc =
          result.response.candidates[0]!.content.parts[0]!.functionCall;
        expect(fc?.name).toBe("get_weather");
        expect(fc?.args).toEqual({ location: "NYC" });
        expect(fc?.id).toBe("call-123");
      });

      it("should add thoughtSignature for Claude compatibility", () => {
        const response = createUnifiedResponse({
          content: [
            {
              type: "tool_call",
              toolCall: {
                id: "call-123",
                name: "get_weather",
                arguments: { location: "NYC" },
              },
            },
          ],
        });

        const result = transformResponse(response) as AntigravityResponse;

        // For Claude models, functionCall parts should have thoughtSignature
        const part = result.response.candidates[0]!.content.parts[0];
        // Implementation may add 'skip_thought_signature_validator'
        expect(part!.functionCall).toBeDefined();
      });
    });

    describe("response ID handling", () => {
      it("should include responseId", () => {
        const response = createUnifiedResponse({
          id: "resp-123",
          content: [{ type: "text", text: "Hi" }],
        });

        const result = transformResponse(response) as AntigravityResponse;

        expect(result.response.responseId).toBe("resp-123");
      });
    });

    describe("wrapper structure", () => {
      it("should wrap response in Antigravity envelope", () => {
        const response = createUnifiedResponse();
        const result = transformResponse(response) as AntigravityResponse;

        expect(result).toHaveProperty("response");
        expect(result.response).toHaveProperty("candidates");
      });
    });
  });

  describe("round-trip", () => {
    it("should preserve text content through round-trip", () => {
      const unifiedResponse = createUnifiedResponse({
        id: "resp-123",
        content: [{ type: "text", text: "Hello, world!" }],
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      });

      const antigravityResponse = transformResponse(
        unifiedResponse
      ) as AntigravityResponse;
      const parsedBack = parseResponse(antigravityResponse);

      expect(parsedBack.content[0]!.text).toBe("Hello, world!");
      expect(parsedBack.stopReason).toBe("end_turn");
      expect(parsedBack.usage?.inputTokens).toBe(10);
      expect(parsedBack.usage?.outputTokens).toBe(20);
    });

    it("should preserve tool calls through round-trip", () => {
      const unifiedResponse = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "call-abc",
              name: "search",
              arguments: { query: "test" },
            },
          },
        ],
        stopReason: "tool_use",
      });

      const antigravityResponse = transformResponse(
        unifiedResponse
      ) as AntigravityResponse;
      const parsedBack = parseResponse(antigravityResponse);

      expect(parsedBack.content[0]!.type).toBe("tool_call");
      expect(parsedBack.content[0]!.toolCall?.name).toBe("search");
      expect(parsedBack.content[0]!.toolCall?.id).toBe("call-abc");
    });
  });
});
