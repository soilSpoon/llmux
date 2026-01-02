import { describe, expect, it } from "bun:test";
import { parseStreamChunk } from "../../../src/providers/gemini/streaming";

describe("Gemini Streaming Block Index Support", () => {
  it("should propagate candidate index as blockIndex for content", () => {
    const chunk = JSON.stringify({
      candidates: [
        {
          index: 3,
          content: {
            role: "model",
            parts: [{ text: "Hello" }],
          },
        },
      ],
    });

    const result = parseStreamChunk(`data: ${chunk}`);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("content");
    expect(result?.blockIndex).toBe(3);
    expect(result?.blockType).toBe("text");
    expect(result?.delta?.text).toBe("Hello");
  });

  it("should propagate candidate index as blockIndex for tool call", () => {
    const chunk = JSON.stringify({
      candidates: [
        {
          index: 5,
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "test_tool",
                  args: { foo: "bar" },
                },
              },
            ],
          },
        },
      ],
    });

    const result = parseStreamChunk(`data: ${chunk}`);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_call");
    expect(result?.blockIndex).toBe(5);
    expect(result?.blockType).toBe("tool_call");
    expect(result?.delta?.toolCall?.name).toBe("test_tool");
  });

  it("should propagate candidate index as blockIndex for thinking", () => {
    const chunk = JSON.stringify({
      candidates: [
        {
          index: 1,
          content: {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Thinking...",
              },
            ],
          },
        },
      ],
    });

    const result = parseStreamChunk(`data: ${chunk}`);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("thinking");
    expect(result?.blockIndex).toBe(1);
    expect(result?.blockType).toBe("thinking");
    expect(result?.delta?.thinking?.text).toBe("Thinking...");
  });

  it("should propagate candidate index as blockIndex for done chunk", () => {
    const chunk = JSON.stringify({
      candidates: [
        {
          index: 2,
          finishReason: "STOP",
        },
      ],
    });

    const result = parseStreamChunk(`data: ${chunk}`);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("done");
    expect(result?.blockIndex).toBe(2);
    expect(result?.stopReason).toBe("end_turn");
  });

  it("should default to blockIndex 0 if index is missing", () => {
    const chunk = JSON.stringify({
      candidates: [
        {
          // index missing
          content: {
            role: "model",
            parts: [{ text: "Default" }],
          },
        },
      ],
    });

    const result = parseStreamChunk(`data: ${chunk}`);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("content");
    expect(result?.blockIndex).toBe(0);
  });
});
