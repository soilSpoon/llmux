import { describe, expect, it } from "bun:test";
import {
  buildSignatureSessionKey,
  shouldCacheSignatures,
  ensureThinkingSignatures,
  type Content,
  type Part,
} from "../signature-integration";

describe("Signature Integration - Layer 3 (Turn Separation)", () => {

  describe("Layer 3 - Turn Separation Recovery", () => {
    it("should separate turn when in tool loop without thinking", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet-thinking",
        "test-conv",
        "proj-1"
      );

      // Create a request body that simulates:
      // - Tool loop (ended with tool_result)
      // - No thinking in the turn
      // - Thinking enabled
      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Use the tool" }],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "test_tool",
                  args: { arg: "value" },
                  id: "tool-1",
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "Result",
              },
            ],
          },
        ] as Content[],
        thinking: { type: "enabled", budget_tokens: 1024 },
      };

      // Apply thinking signatures (which includes Layer 3)
      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-3-5-sonnet-thinking"
      );

      const contents = requestBody.contents as Content[];

      // Should have added 2 synthetic messages
      // Original: 3 items
      // After Layer 3: 5 items (original + synthetic model + synthetic user)
      expect(contents.length).toBe(5);

      // Last two should be synthetic messages
      const syntheticModel = contents[3]!;
      const syntheticUser = contents[4]!;

      // Synthetic model message
      expect(syntheticModel.role).toBe("model");
      expect(Array.isArray(syntheticModel.parts)).toBe(true);
      expect((syntheticModel.parts![0] as Part).text).toContain("completed");

      // Synthetic user message
      expect(syntheticUser.role).toBe("user");
      expect(Array.isArray(syntheticUser.parts)).toBe(true);
      expect((syntheticUser.parts![0] as Part).text).toBe("[Continue]");
    });

    it("should strip thinking and add synthetic messages (opencode strategy)", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet-thinking",
        "test-conv-2",
        "proj-1"
      );

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Use the tool" }],
          },
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "[Thinking about this...]",
                thoughtSignature: "x".repeat(100),
              },
              {
                functionCall: {
                  name: "test_tool",
                  args: { arg: "value" },
                  id: "tool-2",
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                tool_use_id: "tool-2",
                content: "Result",
              },
            ],
          },
        ] as Content[],
        thinking: { type: "enabled", budget_tokens: 1024 },
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-3-5-sonnet-thinking"
      );

      // opencode strategy: strip all thinking, add synthetic messages for tool loop recovery
      // Original 3 items + 2 synthetic = 5
      expect(requestBody.contents.length).toBe(5);

      // Verify thinking was stripped from model message
      const modelContent = requestBody.contents![1]!;
      expect(modelContent.role).toBe("model");
      const parts = modelContent.parts as Part[];
      expect(parts.some((p) => p.thought === true)).toBe(false);
    });

    it("should not separate turn if thinking is disabled", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet",
        "test-conv-3",
        "proj-1"
      );

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Use the tool" }],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "test_tool",
                  args: { arg: "value" },
                  id: "tool-3",
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                tool_use_id: "tool-3",
                content: "Result",
              },
            ],
          },
        ] as Content[],
        // No thinking field or disabled
      };

      const originalLength = requestBody.contents.length;

      // Use an OpenAI model to ensure logic is skipped (Blacklist policy)
      ensureThinkingSignatures(requestBody, sessionKey, "gpt-4");

      // Should not separate because thinking is not enabled
      expect(requestBody.contents.length).toBe(originalLength);
    });

    it("should add synthetic messages for tool loop (opencode strategy, no re-injection)", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet-thinking",
        "test-conv-4",
        "proj-1"
      );

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Use the tool" }],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "test_tool",
                  args: { arg: "value" },
                  id: "tool-4",
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                tool_use_id: "tool-4",
                content: "Result",
              },
            ],
          },
        ] as Content[],
        thinking: { type: "enabled", budget_tokens: 1024 },
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-3-5-sonnet-thinking"
      );

      const contents = requestBody.contents as Content[];

      // opencode strategy: no signature injection, but add synthetic messages
      // Original 3 items + 2 synthetic = 5
      expect(contents.length).toBe(5);

      // The tool function call should NOT have thinking injected
      const toolMessage = contents[1]!;
      expect(Array.isArray(toolMessage.parts)).toBe(true);
      const parts = toolMessage.parts!;
      expect(parts.some((p) => (p as Part).thought === true)).toBe(false);
    });

    it("should count trailing tool results from user messages", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet-thinking",
        "test-conv-5",
        "proj-1"
      );

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Use the tool" }],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "tool_a",
                  args: {},
                  id: "tool-a",
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                tool_use_id: "tool-a",
                content: "Result A",
              },
            ],
          },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "tool_b",
                  args: {},
                  id: "tool-b",
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                tool_use_id: "tool-b",
                content: "Result B",
              },
            ],
          },
        ] as Content[],
        thinking: { type: "enabled", budget_tokens: 1024 },
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-3-5-sonnet-thinking"
      );

      const contents = requestBody.contents as Content[];

      // Should have added synthetic messages (currently counting "1" because
      // closeToolLoopForThinking counts Content items with tool_result parts,
      // not the number of distinct tool calls)
      expect(contents.length).toBeGreaterThan(5);

      // Verify synthetic messages were added
      const syntheticModel = contents[contents.length - 2]!;
      const syntheticUser = contents[contents.length - 1]!;
      expect(syntheticModel.role).toBe("model");
      expect(syntheticUser.role).toBe("user");
    });
  });

  describe("Session key building", () => {
    it("should build consistent session keys", () => {
      const key1 = buildSignatureSessionKey("claude-opus", "conv-1", "proj-1");
      const key2 = buildSignatureSessionKey("claude-opus", "conv-1", "proj-1");
      expect(key1).toBe(key2);
    });

    it("should build different keys for different conversations", () => {
      const key1 = buildSignatureSessionKey("claude-opus", "conv-1", "proj-1");
      const key2 = buildSignatureSessionKey("claude-opus", "conv-2", "proj-1");
      expect(key1).not.toBe(key2);
    });
  });

  describe("Model filtering", () => {
    it("should allow signatures for Claude and Gemini (including pure Gemini), but block OpenAI", () => {
      // Claude thinking - allow
      expect(shouldCacheSignatures("claude-3-5-sonnet-thinking")).toBe(true);
      expect(shouldCacheSignatures("claude-opus-thinking")).toBe(true);

      // Claude non-thinking (relaxed policy) - allow
      expect(shouldCacheSignatures("claude-3-5-sonnet")).toBe(true);

      // Pure Gemini - ALLOW (now managed to prevent corrupted signatures)
      expect(shouldCacheSignatures("gemini-1.5-pro")).toBe(true);
      expect(shouldCacheSignatures("gemini-3-pro-high")).toBe(true);

      // gemini-claude - allow (these are Claude models via Antigravity)
      expect(shouldCacheSignatures("gemini-claude-thinking")).toBe(true);

      // OpenAI - BLOCK (throws 400 Bad Request on unknown fields)
      expect(shouldCacheSignatures("gpt-4")).toBe(false);
      expect(shouldCacheSignatures("gpt-3.5-turbo")).toBe(false);
      expect(shouldCacheSignatures("o1-preview")).toBe(false);
    });

    it("should strip all thinking for gemini-claude (opencode strategy)", () => {
      const sessionKey = buildSignatureSessionKey(
        "gemini-claude-thinking",
        "test-conv-gemini-claude",
        "proj-1"
      );

      const requestBody = {
        contents: [
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Some thinking text",
                thoughtSignature: "bad-signature-to-strip",
              },
              {
                functionCall: {
                  name: "some_tool",
                  args: {},
                },
              },
            ],
          },
        ],
      };

      // Run ensureThinkingSignatures
      ensureThinkingSignatures(requestBody, sessionKey, "gemini-claude-thinking");

      // opencode strategy: strip all thinking, no re-injection
      const parts = requestBody.contents?.[0]?.parts;
      expect(parts).toBeDefined();
      if (!parts) return;

      // Thinking should be stripped
      expect(parts.some((p: any) => p.thought === true)).toBe(false);
      // functionCall should remain
      expect(parts.some((p: any) => p.functionCall)).toBe(true);
    });
  });
});
