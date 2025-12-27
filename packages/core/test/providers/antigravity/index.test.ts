import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import type { StreamChunk } from "../../../src/types/unified";
import type {
  AntigravityRequest,
  AntigravityResponse,
} from "../../../src/providers/antigravity/types";
import {
  createUnifiedRequest,
  createUnifiedMessage,
  createUnifiedResponse,
  createUnifiedTool,
} from "../_utils/fixtures";
import {
  expectRequestRoundTrip,
  expectResponseRoundTrip,
  collectStreamChunks,
} from "../_utils/helpers";

describe("AntigravityProvider", () => {
  const provider = new AntigravityProvider();

  describe("provider metadata", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("antigravity");
    });

    it("should have correct config", () => {
      expect(provider.config.name).toBe("antigravity");
      expect(provider.config.supportsStreaming).toBe(true);
      expect(provider.config.supportsThinking).toBe(true);
      expect(provider.config.supportsTools).toBe(true);
    });
  });

  describe("parse()", () => {
    it("should parse a simple Antigravity request", () => {
      const antigravityRequest: AntigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello");
    });

    it("should extract metadata from wrapper", () => {
      const antigravityRequest: AntigravityRequest = {
        project: "my-project",
        model: "claude-sonnet-4-5",
        userAgent: "antigravity",
        requestId: "agent-456",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          sessionId: "session-abc",
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.metadata?.project).toBe("my-project");
      expect(result.metadata?.model).toBe("claude-sonnet-4-5");
      expect(result.metadata?.sessionId).toBe("session-abc");
    });

    it("should parse system instruction", () => {
      const antigravityRequest: AntigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          systemInstruction: { parts: [{ text: "Be helpful." }] },
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.system).toBe("Be helpful.");
    });

    it("should parse tools", () => {
      const antigravityRequest: AntigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          tools: [
            {
              functionDeclarations: [
                {
                  name: "search",
                  description: "Search the web",
                  parameters: { type: "OBJECT", properties: {} },
                },
              ],
            },
          ],
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("search");
    });

    it("should throw for invalid request", () => {
      expect(() => provider.parse({ invalid: "request" })).toThrow();
    });
  });

  describe("transform()", () => {
    it("should transform a simple UnifiedRequest", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
      });

      const result = provider.transform(request) as AntigravityRequest;

      expect(result.project).toBeDefined();
      expect(result.model).toBeDefined();
      expect(result.userAgent).toBe("antigravity");
      expect(result.requestId).toMatch(/^agent-/);
      expect(result.request.contents[0]!.parts[0]!.text).toBe("Hello");
    });

    it("should use metadata for wrapper fields", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        metadata: {
          project: "custom-project",
          model: "claude-sonnet-4-5",
          sessionId: "session-xyz",
        },
      });

      const result = provider.transform(request) as AntigravityRequest;

      expect(result.project).toBe("custom-project");
      expect(result.model).toBe("claude-sonnet-4-5");
      expect(result.request.sessionId).toBe("session-xyz");
    });

    it("should transform system to systemInstruction", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        system: "You are helpful.",
      });

      const result = provider.transform(request) as AntigravityRequest;

      expect(result.request.systemInstruction?.parts[0]!.text).toBe(
        "You are helpful."
      );
    });

    it("should transform tools with VALIDATED mode", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        tools: [createUnifiedTool("test_tool", "A test tool")],
      });

      const result = provider.transform(request) as AntigravityRequest;

      expect(result.request.tools).toHaveLength(1);
      expect(result.request.toolConfig?.functionCallingConfig?.mode).toBe(
        "VALIDATED"
      );
    });

    it("should use snake_case thinking config for Claude models", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        thinking: { enabled: true, budget: 16384, includeThoughts: true },
        metadata: { model: "claude-sonnet-4-5-thinking" },
      });

      const result = provider.transform(request) as AntigravityRequest;

      expect(
        result.request.generationConfig?.thinkingConfig?.include_thoughts
      ).toBe(true);
      expect(
        result.request.generationConfig?.thinkingConfig?.thinking_budget
      ).toBe(16384);
    });
  });

  describe("parseResponse()", () => {
    it("should parse a simple Antigravity response", () => {
      const response: AntigravityResponse = {
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

      const result = provider.parseResponse(response);

      expect(result.content[0]!.text).toBe("Hello!");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
    });

    it("should parse thinking blocks", () => {
      const response: AntigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    thought: true,
                    text: "Thinking...",
                    thoughtSignature: "sig",
                  },
                  { text: "Answer" },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      };

      const result = provider.parseResponse(response);

      expect(result.thinking).toHaveLength(1);
      expect(result.thinking![0]!.text).toBe("Thinking...");
      expect(result.content[0]!.text).toBe("Answer");
    });

    it("should parse tool calls", () => {
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

      const result = provider.parseResponse(response);

      expect(result.content[0]!.type).toBe("tool_call");
      expect(result.content[0]!.toolCall?.name).toBe("get_weather");
      expect(result.stopReason).toBe("tool_use");
    });

    it("should throw for invalid response", () => {
      expect(() => provider.parseResponse({ invalid: "response" })).toThrow();
    });
  });

  describe("transformResponse()", () => {
    it("should transform a simple UnifiedResponse", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
      });

      const result = provider.transformResponse(
        response
      ) as AntigravityResponse;

      expect(result.response.candidates[0]!.content.parts[0]!.text).toBe(
        "Hello!"
      );
      expect(result.response.candidates[0]!.finishReason).toBe("STOP");
    });

    it("should transform thinking blocks", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Answer" }],
        thinking: [{ text: "Thinking...", signature: "sig123" }],
      });

      const result = provider.transformResponse(
        response
      ) as AntigravityResponse;

      const parts = result.response.candidates[0]!.content.parts;
      expect(parts[0]!.thought).toBe(true);
      expect(parts[0]!.text).toBe("Thinking...");
      expect(parts[0]!.thoughtSignature).toBe("sig123");
    });

    it("should transform tool calls", () => {
      const response = createUnifiedResponse({
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

      const result = provider.transformResponse(
        response
      ) as AntigravityResponse;

      const fc = result.response.candidates[0]!.content.parts[0]!.functionCall;
      expect(fc?.name).toBe("search");
      expect(fc?.id).toBe("call-abc");
    });
  });

  describe("parseStreamChunk()", () => {
    it("should parse text stream chunk", () => {
      const chunk =
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}}';

      const result = provider.parseStreamChunk!(chunk);

      expect((result as StreamChunk | null)?.type).toBe("content");
      expect((result as StreamChunk | null)?.delta?.text).toBe("Hi");
    });

    it("should parse thinking stream chunk", () => {
      const chunk =
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Thinking...","thoughtSignature":"sig"}]}}]}}';

      const result = provider.parseStreamChunk!(chunk);

      expect((result as StreamChunk | null)?.type).toBe("thinking");
      expect((result as StreamChunk | null)?.delta?.thinking?.text).toBe(
        "Thinking..."
      );
    });

    it("should parse done chunk", () => {
      const chunk =
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}]}}';

      const result = provider.parseStreamChunk!(chunk);

      expect((result as StreamChunk | null)?.type).toBe("done");
      expect((result as StreamChunk | null)?.stopReason).toBe("end_turn");
    });

    it("should return null for invalid chunk", () => {
      const result = provider.parseStreamChunk!("data: [DONE]");

      expect(result).toBeNull();
    });
  });

  describe("transformStreamChunk()", () => {
    it("should transform content chunk", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: { type: "text", text: "Hello" },
      };

      const result = provider.transformStreamChunk!(chunk);

      expect(result).toContain("data:");
      expect(result).toContain('"text":"Hello"');
    });

    it("should transform done chunk", () => {
      const chunk: StreamChunk = {
        type: "done",
        stopReason: "end_turn",
      };

      const result = provider.transformStreamChunk!(chunk);

      expect(result).toContain('"finishReason":"STOP"');
    });
  });

  describe("request round-trip", () => {
    it("should maintain text content through round-trip", () => {
      const request = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi there!"),
        ],
        system: "Be helpful",
      });

      expectRequestRoundTrip(provider, request);
    });

    it("should maintain tools through round-trip", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Search for something")],
        tools: [
          createUnifiedTool("search", "Search the web", {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          }),
        ],
      });

      const providerRequest = provider.transform(request);
      const parsed = provider.parse(providerRequest);

      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools![0]!.name).toBe("search");
    });
  });

  describe("response round-trip", () => {
    it("should maintain text content through round-trip", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Hello, world!" }],
        stopReason: "end_turn",
      });

      expectResponseRoundTrip(provider, response);
    });

    it("should maintain tool calls through round-trip", () => {
      const response = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "call-123",
              name: "search",
              arguments: { query: "test" },
            },
          },
        ],
        stopReason: "tool_use",
      });

      const providerResponse = provider.transformResponse(response);
      const parsed = provider.parseResponse(providerResponse);

      expect(parsed.content[0]!.type).toBe("tool_call");
      expect(parsed.content[0]!.toolCall?.name).toBe("search");
    });
  });

  describe("streaming round-trip", () => {
    it("should parse transformed chunks correctly", () => {
      const chunks: StreamChunk[] = [
        { type: "content", delta: { type: "text", text: "Hello" } },
        { type: "content", delta: { type: "text", text: " world" } },
        { type: "done", stopReason: "end_turn" },
      ];

      const transformed = chunks.map((c) => provider.transformStreamChunk!(c));
      const parsed = collectStreamChunks(provider, transformed);

      expect(parsed.length).toBeGreaterThan(0);
    });
  });
});
