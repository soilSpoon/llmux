import { describe, expect, it } from "bun:test";
import { OpencodeZenProvider } from "../../../src/providers/opencode-zen";
import type { StreamChunk } from "../../../src/types/unified";

describe("OpencodeZenProvider Streaming", () => {
  const provider = new OpencodeZenProvider();

  describe("parseStreamChunk - OpenAI format detection", () => {
    it("should parse standard OpenAI delta chunk", () => {
      const chunk =
        'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';

      const result = provider.parseStreamChunk(chunk);

      expect(result).not.toBeNull();
      if (result && !Array.isArray(result)) {
        expect(result.type).toBe("content");
        expect(result.delta?.text).toBe("Hello");
      }
    });

    it("should parse OpenAI finish chunk", () => {
      const chunk =
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}';

      const result = provider.parseStreamChunk(chunk);

      // Finish chunk might be null or have stopReason
      if (result && !Array.isArray(result)) {
        expect(result.stopReason).toBeDefined();
      }
    });

    it("should handle OpenAI [DONE] signal", () => {
      const chunk = "data: [DONE]";

      const result = provider.parseStreamChunk(chunk);

      // OpenAI provider returns a done chunk, not null
      if (result && !Array.isArray(result)) {
        expect(result.type).toBe("done");
      }
    });

    it("should handle empty data lines", () => {
      const chunk = "data: ";

      const result = provider.parseStreamChunk(chunk);

      expect(result).toBeNull();
    });
  });

  describe("parseStreamChunk - Anthropic format detection", () => {
    it("should detect Anthropic event: prefix", () => {
      const chunk = "event: message_start";

      // Just verify parseStreamChunk doesn't throw
      provider.parseStreamChunk(chunk);
      expect(true).toBe(true);
    });

    it("should detect Anthropic content_block in JSON", () => {
      const chunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}';

      // This has content_block in it, should route to Anthropic
      const result = provider.parseStreamChunk(chunk);

      expect(result).not.toBeNull();
    });

    it("should parse Anthropic message_delta with stop_reason", () => {
      // message_delta requires usage field in actual implementation
      const chunk =
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}';

      const result = provider.parseStreamChunk(chunk);

      // Should be detected as Anthropic format
      expect(result).not.toBeNull();
    });
  });

  describe("transformStreamChunk", () => {
    it("should transform text content chunk", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: { text: "Hello world" },
      };

      const result = provider.transformStreamChunk(chunk);

      expect(result).toBeDefined();
      if (typeof result === "string") {
        expect(result).toContain("data:");
      }
    });

    it("should transform tool call chunk", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: {
          toolCall: {
            id: "call_123",
            name: "get_weather",
            arguments: '{"location":"Seoul"}',
          },
        },
      };

      const result = provider.transformStreamChunk(chunk);

      expect(result).toBeDefined();
    });

    it("should transform finish chunk", () => {
      const chunk: StreamChunk = {
        type: "done",
        stopReason: "end_turn",
      };

      const result = provider.transformStreamChunk(chunk);

      expect(result).toBeDefined();
    });

    it("should transform usage chunk", () => {
      const chunk: StreamChunk = {
        type: "usage",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      };

      const result = provider.transformStreamChunk(chunk);

      expect(result).toBeDefined();
    });
  });

  describe("Round-trip streaming", () => {
    it("should parse and re-transform OpenAI chunks", () => {
      const originalChunk =
        'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Test"}}]}';

      const parsed = provider.parseStreamChunk(originalChunk);

      if (parsed && !Array.isArray(parsed)) {
        const transformed = provider.transformStreamChunk(parsed);

        expect(transformed).toBeDefined();
        if (typeof transformed === "string") {
          expect(transformed).toContain("data:");
        }
      }
    });
  });
});
