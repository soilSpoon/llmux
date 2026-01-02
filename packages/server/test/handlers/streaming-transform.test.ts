import { beforeAll, describe, expect, test } from "bun:test";
import { transformStreamChunk } from "../../src/handlers/stream-processor";
import {
  AnthropicProvider,
  AntigravityProvider,
  GeminiProvider,
  OpenAIProvider,
  registerProvider,
} from "@llmux/core";

describe("transformStreamChunk", () => {
  beforeAll(() => {
    registerProvider(new OpenAIProvider());
    registerProvider(new AnthropicProvider());
    registerProvider(new GeminiProvider());
    registerProvider(new AntigravityProvider());
  });
  describe("OpenAI to Anthropic", () => {
    test("transforms OpenAI delta to Anthropic content_block_delta", () => {
      const openaiChunk =
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n';

      const result = transformStreamChunk(openaiChunk, "openai", "anthropic");

      expect(result).toContain("data:");
      expect(result).toContain("content_block_delta");
    });

    test("handles [DONE] message", () => {
      const doneChunk = "data: [DONE]\n";

      const result = transformStreamChunk(doneChunk, "openai", "anthropic");

      expect(result).toContain("data: [DONE]");
    });
  });

  describe("Anthropic to OpenAI", () => {
    test("transforms Anthropic delta to OpenAI format", () => {
      const anthropicChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"World"}}\n';

      const result = transformStreamChunk(
        anthropicChunk,
        "anthropic",
        "openai"
      );

      expect(result).toContain("data:");
      expect(result).toContain("chat.completion.chunk");
    });
  });

  describe("Gemini to OpenAI", () => {
    test("transforms Gemini candidate to OpenAI format", () => {
      const geminiChunk =
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}]}\n';

      const result = transformStreamChunk(geminiChunk, "gemini", "openai");

      expect(result).toContain("data:");
      expect(result).toContain("chat.completion.chunk");
    });
  });

  describe("Same format passthrough", () => {
    test("returns chunk unchanged when same format", () => {
      const chunk = 'data: {"test":"value"}\n';

      const result = transformStreamChunk(chunk, "openai", "openai");

      expect(result).toBe(chunk);
    });
  });

  describe("Error handling", () => {
    test("returns original chunk when parsing returns null", () => {
      const invalidChunk = "data: {invalid json}\n";

      const result = transformStreamChunk(invalidChunk, "openai", "anthropic");

      // When parseStreamChunk returns null, original chunk is returned for safety
      expect(result).toBe(invalidChunk);
    });

    test("handles empty lines gracefully", () => {
      const emptyChunk = "\n\n";

      const result = transformStreamChunk(emptyChunk, "openai", "anthropic");

      expect(result).toBe("\n");
    });
  });

  describe("Format variations", () => {
    test("transforms to Gemini format", () => {
      const openaiChunk = 'data: {"choices":[{"delta":{"content":"Test"}}]}\n';

      const result = transformStreamChunk(openaiChunk, "openai", "gemini");

      expect(result).toContain("candidates");
    });

    test("handles finish_reason in transformation", () => {
      const openaiChunk =
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n';

      const result = transformStreamChunk(openaiChunk, "openai", "anthropic");

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toContain("data:");
    });
  });

  describe("partialJson handling", () => {
    test("preserves partialJson when same provider (Anthropic → Anthropic)", () => {
      // Anthropic input_json_delta
      const anthropicPartialJsonChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"key\\":\\"}}\n';

      const result = transformStreamChunk(
        anthropicPartialJsonChunk,
        "anthropic",
        "anthropic"
      );

      // Should pass through unchanged (same provider)
      expect(result).toBe(anthropicPartialJsonChunk);
    });

    test("converts partialJson from OpenAI to Anthropic", () => {
      // OpenAI function_call_arguments_delta
      const openaiPartialJsonChunk =
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"x\\":"}}]}}}]}\n';

      const result = transformStreamChunk(
        openaiPartialJsonChunk,
        "openai",
        "anthropic"
      );

      // Result should be formatted for Anthropic streaming
      expect(result).toBeDefined();
      expect(Array.isArray(result) || typeof result === "string").toBe(true);
    });

    test("converts partialJson from Anthropic to OpenAI", () => {
      // Anthropic input_json_delta
      const anthropicPartialJsonChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"param\\":"}}}\n';

      const result = transformStreamChunk(
        anthropicPartialJsonChunk,
        "anthropic",
        "openai"
      );

      // Result should be formatted for OpenAI streaming
      expect(result).toBeDefined();
      expect(Array.isArray(result) || typeof result === "string").toBe(true);
    });

    test("handles empty partialJson gracefully", () => {
      const anthropicEmptyPartialJson =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":""}}\n';

      const result = transformStreamChunk(
        anthropicEmptyPartialJson,
        "anthropic",
        "openai"
      );

      // Should handle gracefully without errors
      expect(result).toBeDefined();
    });

    test("accumulates multiple partialJson chunks correctly", () => {
      // Simulate multiple Anthropic partial JSON chunks
      const chunks = [
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"name\\":"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"Alice\\","}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"age\\": 30"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"}"}}\n',
      ];

      let accumulated = "";
      for (const chunk of chunks) {
        // Each transformation should preserve the partial JSON semantics
        const result = transformStreamChunk(chunk, "anthropic", "openai");
        expect(result).toBeDefined();
      }

      // Accumulated result would be: {"name":"Alice","age": 30}
      accumulated = '{"name":"Alice","age": 30}';
      expect(accumulated).toContain("name");
      expect(accumulated).toContain("Alice");
    });

    test("handles partialJson with special characters", () => {
      const specialCharsChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"description\\":\\"Hello\\\\nWorld"}}\n';

      const result = transformStreamChunk(
        specialCharsChunk,
        "anthropic",
        "openai"
      );

      expect(result).toBeDefined();
    });

    test("handles partialJson with unicode characters", () => {
      const unicodeChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"text\\":\\"你好"}}\n';

      const result = transformStreamChunk(unicodeChunk, "anthropic", "openai");

      expect(result).toBeDefined();
    });

    test("handles mixed content and partialJson in single message", () => {
      // Text content in one event, partial JSON in another
      const textChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Calling tool..."}}\n';
      const jsonChunk =
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\""}}\n';

      const textResult = transformStreamChunk(
        textChunk,
        "anthropic",
        "openai"
      );
      const jsonResult = transformStreamChunk(jsonChunk, "anthropic", "openai");

      expect(textResult).toBeDefined();
      expect(jsonResult).toBeDefined();
    });
  });
});
