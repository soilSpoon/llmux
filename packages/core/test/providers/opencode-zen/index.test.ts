import { describe, expect, it } from "bun:test";
import { OpencodeZenProvider } from "../../../src/providers/opencode-zen";
import {
  createUnifiedRequest,
  createUnifiedMessage,
  createUnifiedResponse,
} from "../_utils/fixtures";

describe("OpencodeZenProvider", () => {
  const provider = new OpencodeZenProvider();

  describe("Provider configuration", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("opencode-zen");
    });

    it("should support custom name", () => {
      const custom = new OpencodeZenProvider("opencode-zen");
      expect(custom.name).toBe("opencode-zen");
    });

    it("should have correct config", () => {
      expect(provider.config.name).toBe("opencode-zen");
      expect(provider.config.supportsStreaming).toBe(true);
      expect(provider.config.supportsThinking).toBe(true);
      expect(provider.config.supportsTools).toBe(true);
    });
  });

  describe("parse (Request → UnifiedRequest)", () => {
    it("should parse OpenAI-style request", () => {
      const openaiRequest = {
        model: "glm-4.7-free",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = provider.parse(openaiRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello");
    });

    it("should parse Anthropic-style request with system", () => {
      const anthropicRequest = {
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hello" }],
        system: "You are helpful.",
      };

      const result = provider.parse(anthropicRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.system).toBe("You are helpful.");
    });
  });

  describe("transform (UnifiedRequest → Provider Format)", () => {
    it("should transform to OpenAI format for GLM models", () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        metadata: { model: "glm-4.7-free" },
      });

      const result = provider.transform(unified, 'glm-4.7-free') as {
        model?: string;
        messages?: unknown[];
      };

      expect(result.messages).toBeDefined();
      // OpenAI format has messages array
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it("should transform to Anthropic format for Claude models", () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        metadata: { model: "claude-3-sonnet" },
      });

      const result = provider.transform(unified, 'claude-3-sonnet') as {
        messages?: unknown[];
        max_tokens?: number;
      };

      expect(result.messages).toBeDefined();
      // Anthropic format should have max_tokens
      expect(result.max_tokens).toBeDefined();
    });

    it("should default to OpenAI format when no model specified", () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
      });

      const result = provider.transform(unified, 'test-model') as { messages?: unknown[] };

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe("parseResponse (Provider Response → UnifiedResponse)", () => {
    it("should parse OpenAI-style response", () => {
      const openaiResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        choices: [
          {
            message: { role: "assistant", content: "Hi there!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = provider.parseResponse(openaiResponse);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(result.content[0]!.text).toBe("Hi there!");
    });

    it("should parse Anthropic-style response", () => {
      const anthropicResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello from Claude!" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = provider.parseResponse(anthropicResponse);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(result.content[0]!.text).toBe("Hello from Claude!");
    });
  });

  describe("transformResponse (UnifiedResponse → Provider Format)", () => {
    it("should transform to OpenAI format by default", () => {
      const unified = createUnifiedResponse({
        content: [{ type: "text", text: "Hello!" }],
      });

      const result = provider.transformResponse(unified) as {
        choices?: unknown[];
      };

      // Should be OpenAI format with choices
      expect(result.choices).toBeDefined();
    });
  });

  describe("parseStreamChunk", () => {
    it("should parse OpenAI-style stream chunk", () => {
      const chunk =
        'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hi"}}]}';

      const result = provider.parseStreamChunk(chunk);

      expect(result).not.toBeNull();
      if (result && !Array.isArray(result)) {
        expect(result.type).toBe("content");
        expect(result.delta?.text).toBe("Hi");
      }
    });

    it("should parse Anthropic-style stream chunk", () => {
      // Anthropic format detection uses 'event:' prefix or '"type":"content_block'
      const chunk =
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}';

      const parsedResult = provider.parseStreamChunk(chunk);

      // Anthropic chunks may return array or single chunk
      // Just verify it doesn't throw and returns something
      expect(parsedResult).not.toBeNull();
    });

    it("should handle [DONE] signal", () => {
      const chunk = "data: [DONE]";

      const result = provider.parseStreamChunk(chunk);

      // OpenAI provider returns a done chunk, not null
      if (result && !Array.isArray(result)) {
        expect(result.type).toBe("done");
      }
    });
  });

  describe("transformStreamChunk", () => {
    it("should transform chunk to OpenAI format", () => {
      const chunk = {
        type: "content" as const,
        delta: { text: "Hello" },
      };

      const result = provider.transformStreamChunk(chunk);

      expect(result).toBeDefined();
      // Should produce SSE format string(s)
      if (typeof result === "string") {
        expect(result).toContain("data:");
      } else if (Array.isArray(result)) {
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });
});
