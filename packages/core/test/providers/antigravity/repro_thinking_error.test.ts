
import { describe, expect, it } from "bun:test";
import { transform } from "../../../src/providers/antigravity/request";
import type { AntigravityRequest } from "../../../src/providers/antigravity/types";
import {
  createUnifiedRequest,
} from "../_utils/fixtures";

describe("Antigravity Thinking Block Injection", () => {
  it("should inject thinking block for assistant message with tool call but no thought when thinking is enabled", () => {
    // Scenario: History has an assistant message that used a tool but didn't record a thought.
    // This happens if the previous turn didn't use thinking, or thinking was stripped.
    // Now we request with thinking enabled, and the API requires historical compliance.
    const unifiedRequest = createUnifiedRequest({
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "Do something." }],
        },
        {
          role: "assistant",
          parts: [
             // Missing thinking block here!
            {
              type: "tool_call",
              toolCall: {
                id: "call-legacy",
                name: "legacy_tool",
                arguments: {},
              },
            },
          ],
        },
        {
          role: "tool",
          parts: [
            {
              type: "tool_result",
              toolResult: {
                toolCallId: "call-legacy",
                content: "Done",
              },
            },
          ],
        },
        {
          role: "user",
          parts: [{ type: "text", text: "Great." }],
        },
      ],
      thinking: {
        enabled: true,
        budget: 1024,
      },
    });

    const result = transform(unifiedRequest, 'gemini-2.5-pro') as AntigravityRequest;

    // Check the assistant message (index 1)
    const assistantMsg = result.request.contents[1];
    expect(assistantMsg!.role).toBe("model");
    
    // It should now have a thinking block injected at the start
    const firstPart = assistantMsg!.parts[0]!;
    expect(firstPart.thought).toBe(true);
    expect(firstPart.text).toContain("restored");
    expect(firstPart.thoughtSignature).toBe("skip_thought_signature_validator");
    
    // The second part should be the tool call
    expect(assistantMsg!.parts[1]!.functionCall).toBeDefined();
    expect(assistantMsg!.parts[1]!.functionCall?.name).toBe("legacy_tool");
  });

  it("should NOT inject thinking block if one is already present", () => {
    const unifiedRequest = createUnifiedRequest({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "thinking",
              thinking: { text: "I am thinking", signature: "sig" },
            },
            {
              type: "tool_call",
              toolCall: {
                id: "call-ok",
                name: "ok_tool",
                arguments: {},
              },
            },
          ],
        },
      ],
      thinking: {
        enabled: true
      },
    });

    const result = transform(unifiedRequest, 'gemini-2.5-pro') as AntigravityRequest;
    
    const assistantMsg = result.request.contents[0];
    // Should stay as is
    expect(assistantMsg!.parts[0]!.text).toBe("I am thinking");
    expect(assistantMsg!.parts[0]!.thoughtSignature).toBe("sig");
    expect(assistantMsg!.parts).toHaveLength(2);
  });
});
