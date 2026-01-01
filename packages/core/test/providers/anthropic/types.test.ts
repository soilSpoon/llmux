import { describe, expect, it } from "bun:test";
import {
  type AnthropicRequest,
  type AnthropicResponse,
  type AnthropicMessage,
  type AnthropicContentBlock,
  type AnthropicTool,
  type AnthropicStreamEvent,
  isAnthropicRequest,
  isAnthropicResponse,
  isAnthropicMessage,
  isAnthropicStreamEvent,
} from "../../../src/providers/anthropic/types";

describe("Anthropic Types", () => {
  describe("AnthropicRequest", () => {
    it("should have required model and messages fields", () => {
      const request: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };
      expect(request.model).toBe("claude-sonnet-4-20250514");
      expect(request.messages).toHaveLength(1);
      expect(request.max_tokens).toBe(1024);
    });

    it("should support system as string", () => {
      const request: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        system: "You are a helpful assistant.",
      };
      expect(request.system).toBe("You are a helpful assistant.");
    });

    it("should support system as array of blocks", () => {
      const request: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        system: [{ type: "text", text: "You are a helpful assistant." }],
      };
      expect(Array.isArray(request.system)).toBe(true);
    });

    it("should support thinking configuration", () => {
      const request: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 8000,
        },
      };
      expect(request.thinking?.type).toBe("enabled");
      if (request.thinking?.type === "enabled") {
        expect(request.thinking.budget_tokens).toBe(8000);
      }
    });
  });

  describe("AnthropicMessage", () => {
    it("should support user message with string content", () => {
      const msg: AnthropicMessage = {
        role: "user",
        content: "Hello",
      };
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Hello");
    });

    it("should support user message with content blocks", () => {
      const msg: AnthropicMessage = {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "abc123" },
          },
        ],
      };
      expect(Array.isArray(msg.content)).toBe(true);
    });

    it("should support assistant message with tool_use", () => {
      const msg: AnthropicMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the weather." },
          {
            type: "tool_use",
            id: "toolu_123",
            name: "get_weather",
            input: { location: "NYC" },
          },
        ],
      };
      expect(msg.role).toBe("assistant");
      const toolUse = (msg.content as AnthropicContentBlock[]).find(
        (b) => b.type === "tool_use"
      );
      expect(toolUse?.name).toBe("get_weather");
    });

    it("should support user message with tool_result", () => {
      const msg: AnthropicMessage = {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: '{"temp": 72}',
          },
        ],
      };
      const toolResult = (msg.content as AnthropicContentBlock[])[0]! as {
        type: "tool_result";
        tool_use_id: string;
        content: string;
      };
      expect(toolResult.type).toBe("tool_result");
      expect(toolResult.tool_use_id).toBe("toolu_123");
    });
  });

  describe("AnthropicContentBlock", () => {
    it("should support text block", () => {
      const block: AnthropicContentBlock = { type: "text", text: "Hello" };
      expect(block.type).toBe("text");
    });

    it("should support thinking block with signature", () => {
      const block: AnthropicContentBlock = {
        type: "thinking",
        thinking: "Let me analyze this...",
        signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk...",
      };
      expect(block.type).toBe("thinking");
      expect(block.thinking).toBeDefined();
      expect(block.signature).toBeDefined();
    });

    it("should support image block with base64", () => {
      const block: AnthropicContentBlock = {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc123" },
      };
      expect(block.type).toBe("image");
      expect(block.source?.type).toBe("base64");
    });
  });

  describe("AnthropicTool", () => {
    it("should define tool with input_schema", () => {
      const tool: AnthropicTool = {
        name: "get_weather",
        description: "Get weather for a location",
        input_schema: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
          },
          required: ["location"],
        },
      };
      expect(tool.name).toBe("get_weather");
      expect(tool.input_schema.type).toBe("object");
    });
  });

  describe("AnthropicResponse", () => {
    it("should have required fields", () => {
      const response: AnthropicResponse = {
        id: "msg_01XFDUDYJgAACzvnptvVoYEL",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "Hello!" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };
      expect(response.id).toBeDefined();
      expect(response.type).toBe("message");
      expect(response.stop_reason).toBe("end_turn");
    });

    it("should support thinking blocks in response", () => {
      const response: AnthropicResponse = {
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
          { type: "text", text: "Here is my answer." },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 100 },
      };
      expect(response.content).toHaveLength(2);
      expect(response.content[0]!.type).toBe("thinking");
    });

    it("should support tool_use in response", () => {
      const response: AnthropicResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [
          { type: "tool_use", id: "toolu_123", name: "get_weather", input: {} },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 50 },
      };
      expect(response.stop_reason).toBe("tool_use");
    });
  });

  describe("AnthropicStreamEvent", () => {
    it("should support message_start event", () => {
      const event: AnthropicStreamEvent = {
        type: "message_start",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      };
      expect(event.type).toBe("message_start");
    });

    it("should support content_block_start event", () => {
      const event: AnthropicStreamEvent = {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      };
      expect(event.type).toBe("content_block_start");
    });

    it("should support content_block_delta event", () => {
      const event: AnthropicStreamEvent = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      };
      expect(event.type).toBe("content_block_delta");
      expect((event.delta as { type: string; text?: string })?.text).toBe(
        "Hello"
      );
    });

    it("should support message_delta event", () => {
      const event: AnthropicStreamEvent = {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 50 },
      };
      expect(event.type).toBe("message_delta");
    });
  });

  describe("Type Guards", () => {
    describe("isAnthropicRequest", () => {
      it("should return true for valid Anthropic request", () => {
        const request = {
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 1024,
        };
        expect(isAnthropicRequest(request)).toBe(true);
      });

      it("should return true even without max_tokens (optional field)", () => {
        const request = {
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "Hello" }],
        };
        expect(isAnthropicRequest(request)).toBe(true);
      });

      it("should return false for non-object", () => {
        expect(isAnthropicRequest(null)).toBe(false);
        expect(isAnthropicRequest("string")).toBe(false);
      });
    });

    describe("isAnthropicResponse", () => {
      it("should return true for valid Anthropic response", () => {
        const response = {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "Hello!" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        };
        expect(isAnthropicResponse(response)).toBe(true);
      });

      it("should return false for wrong type field", () => {
        const response = {
          id: "msg_123",
          type: "error",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        };
        expect(isAnthropicResponse(response)).toBe(false);
      });
    });

    describe("isAnthropicMessage", () => {
      it("should return true for valid message", () => {
        expect(isAnthropicMessage({ role: "user", content: "Hello" })).toBe(
          true
        );
        expect(isAnthropicMessage({ role: "assistant", content: [] })).toBe(
          true
        );
      });

      it("should return false for invalid role", () => {
        expect(isAnthropicMessage({ role: "system", content: "Hello" })).toBe(
          false
        );
      });
    });

    describe("isAnthropicStreamEvent", () => {
      it("should return true for valid stream events", () => {
        expect(
          isAnthropicStreamEvent({ type: "message_start", message: {} })
        ).toBe(true);
        expect(
          isAnthropicStreamEvent({
            type: "content_block_delta",
            index: 0,
            delta: {},
          })
        ).toBe(true);
        expect(isAnthropicStreamEvent({ type: "message_stop" })).toBe(true);
      });

      it("should return false for invalid event type", () => {
        expect(isAnthropicStreamEvent({ type: "invalid_event" })).toBe(false);
      });
    });
  });
});
