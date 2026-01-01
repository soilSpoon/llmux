import { describe, expect, it } from "bun:test";
import { AnthropicProvider } from "../../../src/providers/anthropic";
import type {
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from "../../../src/types/unified";
import type {
  AnthropicRequest,
  AnthropicResponse,
} from "../../../src/providers/anthropic/types";
import {
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedMessage,
  createUnifiedTool,
} from "../_utils/fixtures";
import {
  expectRequestRoundTrip,
  expectResponseRoundTrip,
  collectStreamChunks,
} from "../_utils/helpers";

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider();

  describe("Provider configuration", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("anthropic");
    });

    it("should have correct config", () => {
      expect(provider.config.name).toBe("anthropic");
      expect(provider.config.supportsStreaming).toBe(true);
      expect(provider.config.supportsThinking).toBe(true);
      expect(provider.config.supportsTools).toBe(true);
      expect(provider.config.defaultMaxTokens).toBe(4096);
    });
  });

  describe("parse (AnthropicRequest → UnifiedRequest)", () => {
    it("should parse a simple request", () => {
      const anthropicRequest: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello!" }],
        max_tokens: 1024,
      };

      const result = provider.parse(anthropicRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello!");
    });

    it("should parse request with system prompt", () => {
      const anthropicRequest: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1024,
        system: "You are helpful.",
      };

      const result = provider.parse(anthropicRequest);

      expect(result.system).toBe("You are helpful.");
    });

    it("should parse request with tools", () => {
      const anthropicRequest: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Check weather" }],
        max_tokens: 1024,
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      };

      const result = provider.parse(anthropicRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("get_weather");
    });

    it("should parse config parameters", () => {
      const anthropicRequest: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 2000,
        temperature: 0.7,
        top_p: 0.9,
      };

      const result = provider.parse(anthropicRequest);

      expect(result.config?.maxTokens).toBe(2000);
      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.topP).toBe(0.9);
    });

    it("should throw on invalid request", () => {
      expect(() => provider.parse(null)).toThrow();
      expect(() => provider.parse({})).toThrow();
      expect(() => provider.parse({ model: "test" })).toThrow();
    });
  });

  describe("transform (UnifiedRequest → AnthropicRequest)", () => {
    it("should transform a simple request", () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello!")],
      });

      const result = provider.transform(unified) as AnthropicRequest;

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.max_tokens).toBeDefined();
    });

    it("should set default max_tokens if not provided", () => {
      const unified = createUnifiedRequest({
        config: {},
      });

      const result = provider.transform(unified) as AnthropicRequest;

      expect(result.max_tokens).toBe(4096);
    });

    it("should transform system prompt", () => {
      const unified = createUnifiedRequest({
        system: "Be helpful.",
        messages: [createUnifiedMessage("user", "Hi")],
      });

      const result = provider.transform(unified) as AnthropicRequest;

      expect(result.system).toEqual([{ type: "text", text: "Be helpful." }]);
    });

    it("should transform tools", () => {
      const unified = createUnifiedRequest({
        tools: [createUnifiedTool("test_tool", "A test")],
      });

      const result = provider.transform(unified) as AnthropicRequest;

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("test_tool");
    });

    it("should transform thinking config", () => {
      const unified = createUnifiedRequest({
        thinking: { enabled: true, budget: 8000 },
      });

      const result = provider.transform(unified) as AnthropicRequest;

      expect(result.thinking?.type).toBe("enabled");
      if (result.thinking?.type === "enabled") {
        expect(result.thinking.budget_tokens).toBe(8000);
      }
    });
  });

  describe("parseResponse (AnthropicResponse → UnifiedResponse)", () => {
    it("should parse a simple response", () => {
      const anthropicResponse: AnthropicResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "Hello!" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = provider.parseResponse(anthropicResponse);

      expect(result.id).toBe("msg_123");
      expect(result.content[0]!.text).toBe("Hello!");
      expect(result.stopReason).toBe("end_turn");
    });

    it("should parse response with tool_use", () => {
      const anthropicResponse: AnthropicResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "get_weather",
            input: { location: "NYC" },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const result = provider.parseResponse(anthropicResponse);

      expect(result.content[0]!.type).toBe("tool_call");
      expect(result.content[0]!.toolCall?.name).toBe("get_weather");
      expect(result.stopReason).toBe("tool_use");
    });

    it("should parse response with thinking", () => {
      const anthropicResponse: AnthropicResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [
          {
            type: "thinking",
            thinking: "Let me think...",
            signature: "sig123",
          },
          { type: "text", text: "Answer" },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 50 },
      };

      const result = provider.parseResponse(anthropicResponse);

      expect(result.content).toHaveLength(2);
      expect(result.thinking).toHaveLength(1);
      expect(result.thinking![0]!.text).toBe("Let me think...");
    });

    it("should throw on invalid response", () => {
      expect(() => provider.parseResponse(null)).toThrow();
      expect(() => provider.parseResponse({})).toThrow();
    });
  });

  describe("transformResponse (UnifiedResponse → AnthropicResponse)", () => {
    it("should transform a simple response", () => {
      const unified = createUnifiedResponse({
        id: "msg_123",
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
      });

      const result = provider.transformResponse(unified) as AnthropicResponse;

      expect(result.id).toBe("msg_123");
      expect(result.type).toBe("message");
      expect(result.role).toBe("assistant");
      expect(result.content[0]!.type).toBe("text");
    });

    it("should transform response with tool_call", () => {
      const unified: UnifiedResponse = {
        id: "msg_123",
        content: [
          {
            type: "tool_call",
            toolCall: { id: "toolu_123", name: "test", arguments: {} },
          },
        ],
        stopReason: "tool_use",
      };

      const result = provider.transformResponse(unified) as AnthropicResponse;
      expect(result.content[0]!.type).toBe("tool_use");
      expect(result.stop_reason).toBe("tool_use");
    });
  });

  describe("parseStreamChunk", () => {
    it("should parse text delta", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`;

      const result = provider.parseStreamChunk!(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("content");
      expect(result?.delta?.text).toBe("Hello");
    });

    it("should parse message_stop", () => {
      const sseData = `event: message_stop
data: {"type":"message_stop"}`;

      const result = provider.parseStreamChunk!(sseData);

      expect(result?.type).toBe("done");
    });

    it("should return null for ping events", () => {
      const sseData = `event: ping
data: {"type":"ping"}`;

      const result = provider.parseStreamChunk!(sseData);

      expect(result).toBeNull();
    });
  });

  describe("transformStreamChunk", () => {
    it("should transform content chunk", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: { text: "Hello" },
      };

      const result = provider.transformStreamChunk!(chunk);

      expect(result).toContain("text_delta");
      expect(result).toContain("Hello");
    });

    it("should transform done chunk", () => {
      const chunk: StreamChunk = {
        type: "done",
      };

      const result = provider.transformStreamChunk!(chunk);

      const joined = Array.isArray(result) ? result.join("") : result;
      expect(joined).toContain("message_stop");
    });
  });

  describe("Round-trip tests", () => {
    it("should maintain request integrity through round-trip", () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi there!"),
        ],
        system: "Be helpful.",
        config: {
          maxTokens: 2000,
          temperature: 0.7,
        },
      });

      expectRequestRoundTrip(provider, unified);
    });

    it("should maintain response integrity through round-trip", () => {
      const unified = createUnifiedResponse({
        id: "msg_test123",
        content: [{ type: "text", text: "Hello from Claude!" }],
        stopReason: "end_turn",
        model: "claude-sonnet-4-20250514",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      });

      expectResponseRoundTrip(provider, unified);
    });

    it("should handle tool calls through round-trip", () => {
      const unified: UnifiedRequest = {
        messages: [
          createUnifiedMessage("user", "What is the weather?"),
          {
            role: "assistant",
            parts: [
              { type: "text", text: "Let me check." },
              {
                type: "tool_call",
                toolCall: {
                  id: "toolu_test123",
                  name: "get_weather",
                  arguments: { location: "NYC" },
                },
              },
            ],
          },
        ],
      };

      const anthropic = provider.transform(unified) as AnthropicRequest;
      const roundTripped = provider.parse(anthropic);

      expect(roundTripped.messages[1]!.parts[1]!.type).toBe("tool_call");
      expect(roundTripped.messages[1]!.parts[1]!.toolCall?.id).toBe(
        "toolu_test123"
      );
    });
  });

  describe("Stream chunk collection", () => {
    it("should collect stream chunks correctly", () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ];

      const chunks = collectStreamChunks(provider, sseChunks);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      const textChunks = chunks.filter((c) => c.type === "content");
      expect(textChunks.length).toBe(2);
    });
  });
});
