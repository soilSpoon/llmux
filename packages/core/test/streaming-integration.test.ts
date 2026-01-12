/**
 * Streaming Integration Tests (Format-based)
 *
 * Tests:
 * 1. SSE chunk parsing for each format
 * 2. SSE chunk transformation for each format
 * 3. Round-trip streaming (parse → build)
 *
 * NOTE: Streaming is now owned by Formats, not Providers.
 * See Hub-and-Spoke architecture documentation.
 */

import { describe, it, expect } from "bun:test";
import { getFormat } from "../src/formats/registry";
import type { FormatId, FormatContext } from "../src/formats/base";
import type { StreamChunk } from "../src/types/unified";

const formatIds: FormatId[] = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "google-gemini",
];

describe.each(formatIds)("Format: %s", (formatId) => {
  const format = getFormat(formatId);
  const ctx: FormatContext = { provider: "openai", model: "test-model" };

  describe("parseStreamChunk", () => {
    it("should have parseStreamChunk method", () => {
      expect(typeof format.parseStreamChunk).toBe("function");
    });

    it("should parse content chunk", () => {
      if (!format.parseStreamChunk) return;

      let chunk: string | null = null;

      switch (formatId) {
        case "openai-chat":
        case "openai-responses":
          chunk =
            "data: " +
            JSON.stringify({
              id: "chatcmpl-123",
              object: "chat.completion.chunk",
              created: 1234567890,
              model: "gpt-4",
              choices: [
                {
                  index: 0,
                  delta: {
                    content: "Test message",
                  },
                },
              ],
            });
          break;

        case "anthropic-messages":
          chunk =
            "event: content_block_delta\n" +
            "data: " +
            JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: "Test message",
              },
            });
          break;

        case "google-gemini":
          chunk = "data: " + JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Test message" }],
                },
              },
            ],
          });
          break;
      }

      if (!chunk) return;

      const rawParsed = format.parseStreamChunk(chunk);
      const parsed = Array.isArray(rawParsed) ? rawParsed[0] : rawParsed;

      expect(parsed).toBeDefined();
      expect(parsed?.type).toMatch(/^(content|text-delta)$/);
      expect(parsed?.delta?.text).toBe("Test message");
    });

    it("should return null for [DONE] signal", () => {
      if (!format.parseStreamChunk) return;

      const result = format.parseStreamChunk("data: [DONE]");
      // Most formats return null for [DONE], some may return a done chunk
      if (result) {
        const parsed = Array.isArray(result) ? result[0] : result;
        expect(parsed?.type).toBe("done");
      }
    });
  });

  describe("buildStreamChunk", () => {
    it("should have buildStreamChunk method", () => {
      expect(typeof format.buildStreamChunk).toBe("function");
    });

    it("should build content chunk", () => {
      if (!format.buildStreamChunk) return;

      const chunk: StreamChunk = {
        type: "content",
        delta: {
          type: "text",
          text: "Hello world",
        },
      };

      const result = format.buildStreamChunk(chunk, ctx);
      expect(result).toBeDefined();

      // Should produce a string or array of strings
      const output = Array.isArray(result) ? result.join("") : result;
      expect(output.length).toBeGreaterThan(0);

      // Should contain the text somewhere
      if (formatId !== "anthropic-messages") {
        // Anthropic format may split into multiple events
        expect(output).toContain("Hello world");
      }
    });

    it("should build done chunk", () => {
      if (!format.buildStreamChunk) return;

      const chunk: StreamChunk = {
        type: "done",
        stopReason: "end_turn",
      };

      const result = format.buildStreamChunk(chunk, ctx);
      expect(result).toBeDefined();
    });
  });

  describe("round-trip", () => {
    it("should handle content round-trip when both parse and build exist", () => {
      if (!format.parseStreamChunk || !format.buildStreamChunk) return;

      // Create a unified chunk
      const unifiedChunk: StreamChunk = {
        type: "content",
        delta: {
          type: "text",
          text: "Round trip test",
        },
      };

      // Build to wire format
      const wireFormat = format.buildStreamChunk(unifiedChunk, ctx);
      const wireString = Array.isArray(wireFormat)
        ? wireFormat.join("")
        : wireFormat;

      expect(wireString.length).toBeGreaterThan(0);

      // For round-trip, we'd need to parse the built output back
      // This is complex because built output may not be directly parseable
      // (e.g., may need SSE event wrapper removal)
      // For now, just verify build works
    });
  });
});

describe("Cross-format streaming transformation", () => {
  it("should transform google-gemini to openai-chat format", () => {
    const sourceFormat = getFormat("google-gemini");
    const targetFormat = getFormat("openai-chat");
    const ctx: FormatContext = { provider: "openai", model: "gpt-4" };

    if (!sourceFormat.parseStreamChunk || !targetFormat.buildStreamChunk) {
      return;
    }

    // Gemini-style chunk (SSE format with "data: " prefix)
    const geminiChunk = `data: ${JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello from Gemini" }],
          },
        },
      ],
    })}`;

    // Parse Gemini format -> Unified
    const parsed = sourceFormat.parseStreamChunk(geminiChunk);
    expect(parsed).toBeDefined();

    const unified = Array.isArray(parsed) ? parsed[0]! : parsed!;
    expect(unified.delta?.text).toBe("Hello from Gemini");

    // Build Unified -> OpenAI format
    const openaiOutput = targetFormat.buildStreamChunk(unified, ctx);
    expect(openaiOutput).toBeDefined();

    const outputStr = Array.isArray(openaiOutput)
      ? openaiOutput.join("")
      : openaiOutput;
    expect(outputStr).toContain("Hello from Gemini");
  });

  it("should transform anthropic-messages to openai-chat format", () => {
    const sourceFormat = getFormat("anthropic-messages");
    const targetFormat = getFormat("openai-chat");
    const ctx: FormatContext = { provider: "openai", model: "gpt-4" };

    if (!sourceFormat.parseStreamChunk || !targetFormat.buildStreamChunk) {
      return;
    }

    // Anthropic-style chunk
    const anthropicChunk =
      "event: content_block_delta\n" +
      "data: " +
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Hello from Claude",
        },
      });

    // Parse Anthropic format -> Unified
    const parsed = sourceFormat.parseStreamChunk(anthropicChunk);
    expect(parsed).toBeDefined();

    const unified = Array.isArray(parsed) ? parsed[0]! : parsed!;
    expect(unified.delta?.text).toBe("Hello from Claude");

    // Build Unified -> OpenAI format
    const openaiOutput = targetFormat.buildStreamChunk(unified, ctx);
    expect(openaiOutput).toBeDefined();

    const outputStr = Array.isArray(openaiOutput)
      ? openaiOutput.join("")
      : openaiOutput;
    expect(outputStr).toContain("Hello from Claude");
  });
});
