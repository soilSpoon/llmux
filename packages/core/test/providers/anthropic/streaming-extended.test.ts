import { describe, expect, it } from "bun:test";
import {
  parseStreamChunk,
  transformStreamChunk,
} from "../../../src/providers/anthropic/streaming";
import { parseResponse } from "../../../src/providers/anthropic/response";
import type { AnthropicResponse } from "../../../src/providers/anthropic/types";

describe("Anthropic Extended Streaming & Response Support", () => {
  describe("Multi-block Streaming Support", () => {
    it("should propagate blockIndex in content_block_start for text", () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("content");
      expect(result?.blockIndex).toBe(1);
      expect(result?.blockType).toBe("text");
    });

    it("should propagate blockIndex in content_block_start for tool_use", () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_123","name":"test_tool","input":{}}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("tool_call");
      expect(result?.blockIndex).toBe(2);
      expect(result?.blockType).toBe("tool_call");
      expect(result?.delta?.toolCall?.id).toBe("toolu_123");
    });

    it("should propagate blockIndex in content_block_start for thinking", () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("thinking");
      expect(result?.blockIndex).toBe(0);
      expect(result?.blockType).toBe("thinking");
    });

    it("should propagate blockIndex in content_block_delta for text", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("content");
      expect(result?.blockIndex).toBe(1);
      expect(result?.blockType).toBe("text");
      expect(result?.delta?.text).toBe("Hello");
    });

    it("should propagate blockIndex in content_block_delta for thinking", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("thinking");
      expect(result?.blockIndex).toBe(0);
      expect(result?.blockType).toBe("thinking");
      expect(result?.delta?.thinking?.text).toBe("Hmm");
    });

    it("should propagate blockIndex in content_block_delta for tool input", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("tool_call");
      expect(result?.blockIndex).toBe(2);
      expect(result?.blockType).toBe("tool_call");
      expect(result?.delta?.partialJson).toBe("{");
    });

    it("should handle content_block_stop by returning block_stop chunk", () => {
      const sseData = `event: content_block_stop
data: {"type":"content_block_stop","index":1}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("block_stop");
      expect(result?.blockIndex).toBe(1);
    });
  });

  describe("Streaming Transformation (Unified -> SSE)", () => {
    it("should use blockIndex when transforming content chunks", () => {
      const chunk = {
        type: "content" as const,
        blockIndex: 5,
        delta: { type: "text" as const, text: "Data" },
      };

      const sse = transformStreamChunk(chunk);
      // Depending on implementation details, it might be a string or array of strings
      const sseString = Array.isArray(sse) ? sse[0] : sse;
      
      expect(sseString).toContain('"index":5');
      expect(sseString).toContain('"text":"Data"');
    });

    it("should transform block_stop chunk to content_block_stop event", () => {
      const chunk = {
        type: "block_stop" as const,
        blockIndex: 3,
      };

      const sse = transformStreamChunk(chunk);
      const sseString = Array.isArray(sse) ? sse[0] : sse;

      expect(sseString).toContain("content_block_stop");
      expect(sseString).toContain('"index":3');
    });
  });

  describe("Extended Response Parsing", () => {
    it("should parse redacted_thinking blocks", () => {
      const response: AnthropicResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-3-7-sonnet-20250219",
        content: [
          {
            type: "redacted_thinking",
            data: "redacted_data_base64",
          },
          {
            type: "text",
            text: "Hello",
          }
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 }
      };

      const unified = parseResponse(response);
      
      expect(unified.thinking).toBeDefined();
      expect(unified.thinking).toHaveLength(1);
      expect(unified.thinking![0]!.redacted).toBe(true);
      expect(unified.thinking![0]!.text).toBe("");
    });

    it("should parse tool_result blocks in content (rare but possible in some contexts)", () => {
      // Typically tool_result comes from user, but for completeness let's test the parser logic
      // Assuming we reuse the same parser logic or if we test generic block parsing
      
      // Note: In strict Anthropic API, tool_result is user role. 
      // But parseResponse might be used on objects that structurally match but are from history.
      // Let's create a mock object that satisfies the type check but mimics a tool_result structure
      // passed through the parser.
      
      const response = {
        id: "msg_123",
        type: "message",
        role: "assistant", // Usually user, but we're testing the block parser
        model: "test-model",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "Result data",
            is_error: false
          }
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 }
      };

      const unified = parseResponse(response);
      
      expect(unified.content).toHaveLength(1);
      expect(unified.content[0]!.type).toBe("tool_result");
      expect(unified.content[0]!.toolResult?.toolCallId).toBe("toolu_123");
      expect(unified.content[0]!.toolResult?.content).toBe("Result data");
    });
  });
});
