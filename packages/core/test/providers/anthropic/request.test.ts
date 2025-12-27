import { describe, expect, it } from "bun:test";
import { parse, transform } from "../../../src/providers/anthropic/request";
import type { UnifiedRequest } from "../../../src/types/unified";
import type { AnthropicRequest } from "../../../src/providers/anthropic/types";
import {
  createUnifiedRequest,
  createUnifiedMessage,
  createUnifiedTool,
} from "../_utils/fixtures";

describe("Anthropic Request Transformations", () => {
  describe("transform (UnifiedRequest → AnthropicRequest)", () => {
    it("should transform a simple text message", () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello, Claude!")],
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.content).toEqual([
        { type: "text", text: "Hello, Claude!" },
      ]);
    });

    it("should set max_tokens from config (required for Anthropic)", () => {
      const unified = createUnifiedRequest({
        config: { maxTokens: 2048 },
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.max_tokens).toBe(2048);
    });

    it("should default max_tokens to 4096 if not provided", () => {
      const unified = createUnifiedRequest({
        config: {},
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.max_tokens).toBe(4096);
    });

    it("should transform system prompt to separate system field", () => {
      const unified = createUnifiedRequest({
        system: "You are a helpful assistant.",
        messages: [createUnifiedMessage("user", "Hello")],
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.system).toEqual([
        { type: "text", text: "You are a helpful assistant." },
      ]);
      // System should NOT be in messages
      expect(
        result.messages.every((m) => (m.role as string) !== "system")
      ).toBe(true);
    });

    it("should transform multiple messages", () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi there!"),
          createUnifiedMessage("user", "How are you?"),
        ],
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[1]!.role).toBe("assistant");
      expect(result.messages[2]!.role).toBe("user");
    });

    it("should transform image content parts", () => {
      const unified: UnifiedRequest = {
        messages: [
          {
            role: "user",
            parts: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image",
                image: { mimeType: "image/png", data: "base64data" },
              },
            ],
          },
        ],
      };

      const result = transform(unified) as AnthropicRequest;

      expect(result.messages[0]!.content).toHaveLength(2);
      const content = result.messages[0]!.content as Array<{ type: string }>;
      expect(content[0]!.type).toBe("text");
      expect(content[1]!.type).toBe("image");
      expect((content[1]! as any).source.type).toBe("base64");
      expect((content[1]! as any).source.media_type).toBe("image/png");
      expect((content[1]! as any).source.data).toBe("base64data");
    });

    it("should transform image URL content parts", () => {
      const unified: UnifiedRequest = {
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "image",
                image: {
                  mimeType: "image/jpeg",
                  url: "https://example.com/image.jpg",
                },
              },
            ],
          },
        ],
      };

      const result = transform(unified) as AnthropicRequest;

      const content = result.messages[0]!.content as Array<{ type: string }>;
      expect(content[0]!.type).toBe("image");
      expect((content[0]! as any).source.type).toBe("url");
      expect((content[0]! as any).source.url).toBe(
        "https://example.com/image.jpg"
      );
    });

    it("should transform tools to Anthropic format", () => {
      const unified = createUnifiedRequest({
        tools: [
          createUnifiedTool("get_weather", "Get weather for a location", {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
            },
            required: ["location"],
          }),
        ],
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("get_weather");
      expect(result.tools![0]!.description).toBe("Get weather for a location");
      expect(result.tools![0]!.input_schema).toEqual({
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
        },
        required: ["location"],
      });
    });

    it("should transform tool_call parts in assistant messages", () => {
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
                  id: "toolu_123",
                  name: "get_weather",
                  arguments: { location: "NYC" },
                },
              },
            ],
          },
        ],
      };

      const result = transform(unified) as AnthropicRequest;

      const content = result.messages[1]!.content as Array<{ type: string }>;
      expect(content).toHaveLength(2);
      expect(content[0]!.type).toBe("text");
      expect(content[1]!.type).toBe("tool_use");
      expect((content[1]! as any).id).toBe("toolu_123");
      expect((content[1]! as any).name).toBe("get_weather");
      expect((content[1]! as any).input).toEqual({ location: "NYC" });
    });

    it("should transform tool_result parts in user messages", () => {
      const unified: UnifiedRequest = {
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                toolResult: {
                  toolCallId: "toolu_123",
                  content: '{"temp": 72, "unit": "F"}',
                },
              },
            ],
          },
        ],
      };

      const result = transform(unified) as AnthropicRequest;

      const content = result.messages[0]!.content as Array<{ type: string }>;
      expect(content[0]!.type).toBe("tool_result");
      expect((content[0]! as any).tool_use_id).toBe("toolu_123");
      expect((content[0]! as any).content).toBe('{"temp": 72, "unit": "F"}');
    });

    it("should transform tool_result with is_error flag", () => {
      const unified: UnifiedRequest = {
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                toolResult: {
                  toolCallId: "toolu_123",
                  content: "Error: City not found",
                  isError: true,
                },
              },
            ],
          },
        ],
      };

      const result = transform(unified) as AnthropicRequest;

      const content = result.messages[0]!.content as Array<{ type: string }>;
      expect((content[0]! as any).is_error).toBe(true);
    });

    it("should transform generation config parameters", () => {
      const unified = createUnifiedRequest({
        config: {
          maxTokens: 2000,
          temperature: 0.8,
          topP: 0.9,
          topK: 40,
          stopSequences: ["END", "STOP"],
        },
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.max_tokens).toBe(2000);
      expect(result.temperature).toBe(0.8);
      expect(result.top_p).toBe(0.9);
      expect(result.top_k).toBe(40);
      expect(result.stop_sequences).toEqual(["END", "STOP"]);
    });

    it("should transform thinking config to Anthropic thinking format", () => {
      const unified = createUnifiedRequest({
        thinking: {
          enabled: true,
          budget: 16000,
        },
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.thinking).toEqual({
        type: "enabled",
        budget_tokens: 16000,
      });
    });

    it("should not include thinking if disabled", () => {
      const unified = createUnifiedRequest({
        thinking: {
          enabled: false,
        },
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.thinking).toBeUndefined();
    });

    it("should transform thinking parts in assistant messages", () => {
      const unified: UnifiedRequest = {
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "thinking",
                thinking: {
                  text: "Let me analyze this step by step...",
                  signature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk",
                },
              },
              { type: "text", text: "Based on my analysis..." },
            ],
          },
        ],
      };

      const result = transform(unified) as AnthropicRequest;

      const content = result.messages[0]!.content as Array<{ type: string }>;
      expect(content[0]!.type).toBe("thinking");
      expect((content[0]! as any).thinking).toBe(
        "Let me analyze this step by step..."
      );
      expect((content[0]! as any).signature).toBe(
        "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk"
      );
    });

    it("should handle metadata with user_id", () => {
      const unified = createUnifiedRequest({
        metadata: {
          userId: "user_123",
        },
      });

      const result = transform(unified) as AnthropicRequest;

      expect(result.metadata).toEqual({ user_id: "user_123" });
    });
  });

  describe("parse (AnthropicRequest → UnifiedRequest)", () => {
    it("should parse a simple text message", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello!" }],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.parts[0]!.type).toBe("text");
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello!");
    });

    it("should parse string content as text part", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Simple string" }],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts[0]!.text).toBe("Simple string");
    });

    it("should parse system field to unified system", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        system: "You are a helpful assistant.",
      };

      const result = parse(anthropic);

      expect(result.system).toBe("You are a helpful assistant.");
    });

    it("should parse system array to unified system string", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        system: [
          { type: "text", text: "You are helpful." },
          { type: "text", text: "Be concise." },
        ],
      };

      const result = parse(anthropic);

      expect(result.system).toBe("You are helpful.\nBe concise.");
    });

    it("should parse content blocks array", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "abc123",
                },
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts).toHaveLength(2);
      expect(result.messages[0]!.parts[0]!.type).toBe("text");
      expect(result.messages[0]!.parts[1]!.type).toBe("image");
      expect(result.messages[0]!.parts[1]!.image?.mimeType).toBe("image/png");
      expect(result.messages[0]!.parts[1]!.image?.data).toBe("abc123");
    });

    it("should parse image URL source", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: "https://example.com/img.jpg" },
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts[0]!.image?.url).toBe(
        "https://example.com/img.jpg"
      );
    });

    it("should parse tool_use blocks to tool_call parts", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "Let me check." },
              {
                type: "tool_use",
                id: "toolu_123",
                name: "get_weather",
                input: { location: "NYC" },
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts).toHaveLength(2);
      expect(result.messages[0]!.parts[1]!.type).toBe("tool_call");
      expect(result.messages[0]!.parts[1]!.toolCall?.id).toBe("toolu_123");
      expect(result.messages[0]!.parts[1]!.toolCall?.name).toBe("get_weather");
      expect(result.messages[0]!.parts[1]!.toolCall?.arguments).toEqual({
        location: "NYC",
      });
    });

    it("should parse tool_result blocks to tool_result parts", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_123",
                content: '{"temp": 72}',
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts[0]!.type).toBe("tool_result");
      expect(result.messages[0]!.parts[0]!.toolResult?.toolCallId).toBe(
        "toolu_123"
      );
      expect(result.messages[0]!.parts[0]!.toolResult?.content).toBe(
        '{"temp": 72}'
      );
    });

    it("should parse tool_result with is_error", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_123",
                content: "Error occurred",
                is_error: true,
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts[0]!.toolResult?.isError).toBe(true);
    });

    it("should parse thinking blocks", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Let me analyze...",
                signature: "sig123",
              },
              { type: "text", text: "Here is my answer." },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const result = parse(anthropic);

      expect(result.messages[0]!.parts[0]!.type).toBe("thinking");
      expect(result.messages[0]!.parts[0]!.thinking?.text).toBe(
        "Let me analyze..."
      );
      expect(result.messages[0]!.parts[0]!.thinking?.signature).toBe("sig123");
    });

    it("should parse tools to unified format", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
      };

      const result = parse(anthropic);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("get_weather");
      expect(result.tools![0]!.description).toBe("Get weather");
      expect(result.tools![0]!.parameters).toEqual({
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      });
    });

    it("should parse generation config", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 2000,
        temperature: 0.8,
        top_p: 0.9,
        top_k: 40,
        stop_sequences: ["END"],
      };

      const result = parse(anthropic);

      expect(result.config?.maxTokens).toBe(2000);
      expect(result.config?.temperature).toBe(0.8);
      expect(result.config?.topP).toBe(0.9);
      expect(result.config?.topK).toBe(40);
      expect(result.config?.stopSequences).toEqual(["END"]);
    });

    it("should parse thinking configuration", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 8000,
        },
      };

      const result = parse(anthropic);

      expect(result.thinking?.enabled).toBe(true);
      expect(result.thinking?.budget).toBe(8000);
    });

    it("should parse metadata user_id", () => {
      const anthropic: AnthropicRequest = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        metadata: { user_id: "user_123" },
      };

      const result = parse(anthropic);

      expect(result.metadata?.userId).toBe("user_123");
    });
  });

  describe("Round-trip transformations", () => {
    it("should maintain message content through transform → parse", () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi there!"),
        ],
        system: "Be helpful.",
      });

      const anthropic = transform(unified) as AnthropicRequest;
      const roundTripped = parse(anthropic);

      expect(roundTripped.messages).toHaveLength(2);
      expect(roundTripped.messages![0]!.parts[0]!.text).toBe("Hello");
      expect(roundTripped.messages![1]!.parts[0]!.text).toBe("Hi there!");
      expect(roundTripped.system).toBe("Be helpful.");
    });

    it("should maintain tool definitions through transform → parse", () => {
      const unified = createUnifiedRequest({
        tools: [
          createUnifiedTool("test_tool", "A test tool", {
            type: "object",
            properties: { param: { type: "string" } },
          }),
        ],
      });

      const anthropic = transform(unified) as AnthropicRequest;
      const roundTripped = parse(anthropic);

      expect(roundTripped.tools).toHaveLength(1);
      expect(roundTripped.tools![0]!.name).toBe("test_tool");
    });
  });
});
