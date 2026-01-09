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
    const parsed = Array.isArray(result) ? result[result.length - 1] : result;

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("content");
    expect(parsed?.blockIndex).toBe(3);
    expect(parsed?.blockType).toBe("text");
    expect(parsed?.delta?.text).toBe("Hello");
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
    const parsed = Array.isArray(result) ? result[result.length - 1] : result;

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("tool_call");
    expect(parsed?.blockIndex).toBe(5);
    expect(parsed?.blockType).toBe("tool_call");
    expect(parsed?.delta?.toolCall?.name).toBe("test_tool");
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

    const parsed = Array.isArray(result) ? result[result.length - 1] : result;

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("thinking");
    expect(parsed?.blockIndex).toBe(1);
    expect(parsed?.blockType).toBe("thinking");
    expect(parsed?.delta?.thinking?.text).toBe("Thinking...");
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

    const parsed = Array.isArray(result) ? result[result.length - 1] : result;

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("done");
    expect(parsed?.blockIndex).toBe(2);
    expect(parsed?.stopReason).toBe("end_turn");
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

    const parsed = Array.isArray(result) ? result[result.length - 1] : result;

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("content");
    expect(parsed?.blockIndex).toBe(0);
  });
});
