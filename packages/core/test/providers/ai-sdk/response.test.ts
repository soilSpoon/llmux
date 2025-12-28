import { describe, expect, it } from "bun:test";
import {
  parseResponse,
  transformResponse,
} from "../../../src/providers/ai-sdk/response";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import type { StopReason } from "../../../src/types/unified";
import { createUnifiedResponse } from "../_utils/fixtures";

describe("AI SDK Response Transformations", () => {
  describe("parseResponse", () => {
    it("parses basic text response", () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [{ type: "text", text: "Hello there!" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
        response: {
          id: "resp-123",
          modelId: "gpt-4",
          timestamp: new Date(),
        },
      };

      const result = parseResponse(aiSdkResult);

      expect(result.id).toBe("resp-123");
      expect(result.model).toBe("gpt-4");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe("Hello there!");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
    });

    it("parses response with reasoning content", () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [
          { type: "reasoning", text: "Let me think..." },
          { type: "text", text: "The answer is 42." },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 15, text: 5, reasoning: 10 },
        },
        warnings: [],
      };

      const result = parseResponse(aiSdkResult);

      expect(result.thinking).toHaveLength(1);
      expect(result.thinking?.[0]?.text).toBe("Let me think...");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toBe("The answer is 42.");
      expect(result.usage?.thinkingTokens).toBe(10);
    });

    it("parses response with tool call", () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_abc",
            toolName: "get_weather",
            input: '{"location":"NYC"}',
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 5, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };

      const result = parseResponse(aiSdkResult);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("tool_call");
      expect(result.content[0]?.toolCall?.id).toBe("call_abc");
      expect(result.content[0]?.toolCall?.name).toBe("get_weather");
      expect(result.content[0]?.toolCall?.arguments).toEqual({
        location: "NYC",
      });
      expect(result.stopReason).toBe("tool_use");
    });

    it("parses response with file content", () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [
          { type: "file", mediaType: "image/png", data: "base64imagedata" },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 100, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };

      const result = parseResponse(aiSdkResult);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("image");
      expect(result.content[0]?.image?.mimeType).toBe("image/png");
      expect(result.content[0]?.image?.data).toBe("base64imagedata");
    });

    it("parses various finish reasons", () => {
      const testCases: Array<{
        unified:
          | "stop"
          | "length"
          | "tool-calls"
          | "content-filter"
          | "error"
          | "other";
        expected: string | null;
      }> = [
        { unified: "stop", expected: "end_turn" },
        { unified: "length", expected: "max_tokens" },
        { unified: "tool-calls", expected: "tool_use" },
        { unified: "content-filter", expected: "content_filter" },
        { unified: "error", expected: "error" },
        { unified: "other", expected: null },
      ];

      for (const { unified, expected } of testCases) {
        const result = parseResponse({
          content: [{ type: "text", text: "test" }],
          finishReason: { unified, raw: "raw" },
          usage: {
            inputTokens: {
              total: 0,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 0, text: undefined, reasoning: undefined },
          },
          warnings: [],
        });
        expect(result.stopReason).toBe(expected as StopReason);
      }
    });

    it("parses cached token usage", () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [{ type: "text", text: "Hello" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 100,
            noCache: 20,
            cacheRead: 80,
            cacheWrite: undefined,
          },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      };

      const result = parseResponse(aiSdkResult);

      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.cachedTokens).toBe(80);
    });
  });

  describe("transformResponse", () => {
    it("transforms basic UnifiedResponse to AI SDK format", () => {
      const unified = createUnifiedResponse({
        id: "resp-123",
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
        model: "gpt-4",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      });

      const result = transformResponse(unified);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      expect((result.content[0] as { text: string }).text).toBe("Hello!");
      expect(result.finishReason.unified).toBe("stop");
      expect(result.usage.inputTokens.total).toBe(10);
      expect(result.usage.outputTokens.total).toBe(5);
      expect(result.response?.id).toBe("resp-123");
      expect(result.response?.modelId).toBe("gpt-4");
    });

    it("transforms response with thinking blocks", () => {
      const unified = createUnifiedResponse({
        content: [{ type: "text", text: "Answer" }],
        thinking: [{ text: "Let me think..." }],
        stopReason: "end_turn",
      });

      const result = transformResponse(unified);

      // Thinking blocks come first
      expect(result.content).toHaveLength(2);
      expect(result.content[0]?.type).toBe("reasoning");
      expect((result.content[0] as { text: string }).text).toBe(
        "Let me think..."
      );
      expect(result.content[1]?.type).toBe("text");
    });

    it("transforms response with tool call", () => {
      const unified = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "call_123",
              name: "get_weather",
              arguments: { location: "NYC" },
            },
          },
        ],
        stopReason: "tool_use",
      });

      const result = transformResponse(unified);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("tool-call");
      const toolCall = result.content[0] as {
        toolCallId: string;
        toolName: string;
        input: string;
      };
      expect(toolCall.toolCallId).toBe("call_123");
      expect(toolCall.toolName).toBe("get_weather");
      expect(toolCall.input).toBe('{"location":"NYC"}');
      expect(result.finishReason.unified).toBe("tool-calls");
    });

    it("transforms various stop reasons", () => {
      const testCases = [
        { stopReason: "end_turn", expected: "stop" },
        { stopReason: "max_tokens", expected: "length" },
        { stopReason: "tool_use", expected: "tool-calls" },
        { stopReason: "content_filter", expected: "content-filter" },
        { stopReason: "stop_sequence", expected: "stop" },
        { stopReason: "error", expected: "error" },
        { stopReason: null, expected: "other" },
      ] as const;

      for (const { stopReason, expected } of testCases) {
        const unified = createUnifiedResponse({
          content: [{ type: "text", text: "test" }],
          stopReason: stopReason as StopReason,
        });
        const result = transformResponse(unified);
        expect(result.finishReason.unified).toBe(expected);
      }
    });

    it("transforms usage with thinking tokens", () => {
      const unified = createUnifiedResponse({
        content: [{ type: "text", text: "Answer" }],
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          thinkingTokens: 30,
          cachedTokens: 20,
        },
        stopReason: "end_turn",
      });

      const result = transformResponse(unified);

      expect(result.usage.inputTokens.total).toBe(100);
      expect(result.usage.inputTokens.cacheRead).toBe(20);
      expect(result.usage.inputTokens.noCache).toBe(80); // 100 - 20
      expect(result.usage.outputTokens.total).toBe(50);
      expect(result.usage.outputTokens.reasoning).toBe(30);
      expect(result.usage.outputTokens.text).toBe(20); // 50 - 30
    });
  });

  describe("round-trip", () => {
    it("preserves content through parseResponse -> transformResponse", () => {
      const aiSdkResult: LanguageModelV3GenerateResult = {
        content: [{ type: "text", text: "Hello!" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
        response: {
          id: "resp-123",
          modelId: "gpt-4",
        },
      };

      const unified = parseResponse(aiSdkResult);
      const result = transformResponse(unified);

      expect(result.content[0]?.type).toBe("text");
      expect((result.content[0] as { text: string }).text).toBe("Hello!");
      expect(result.finishReason.unified).toBe("stop");
      expect(result.response?.id).toBe("resp-123");
    });
  });
});
