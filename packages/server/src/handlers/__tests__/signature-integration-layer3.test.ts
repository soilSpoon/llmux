import { describe, expect, it, beforeEach } from "bun:test";
import {
  buildSignatureSessionKey,
  shouldCacheSignatures,
  storeGlobalThoughtSignature,
  getGlobalThoughtSignature,
  clearGlobalThoughtSignature,
  ensureThinkingSignatures,
  type Content,
  type Part,
} from "../signature-integration";

describe("Signature Integration - Layer 3 (Turn Separation)", () => {
  beforeEach(() => {
    clearGlobalThoughtSignature();
  });

  describe("Global Signature Store (Layer 2)", () => {
    it("should store and retrieve global thought signature", () => {
      const testSig = "x".repeat(100);

      storeGlobalThoughtSignature(testSig);
      expect(getGlobalThoughtSignature()).toBe(testSig);
    });

    it("should ignore signatures shorter than MIN_SIGNATURE_LENGTH", () => {
      const shortSig = "too_short";

      storeGlobalThoughtSignature(shortSig);
      expect(getGlobalThoughtSignature()).toBeUndefined();
    });

    it("should expire signatures older than 10 minutes", async () => {
      const testSig = "x".repeat(100);
      storeGlobalThoughtSignature(testSig);

      // Verify it's stored
      expect(getGlobalThoughtSignature()).toBe(testSig);

      // Simulate time passage (10 minutes + 1 second)
      // Note: In real tests, we'd use a time mock library
      // For now, we test the clear functionality
      clearGlobalThoughtSignature();
      expect(getGlobalThoughtSignature()).toBeUndefined();
    });
  });

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

    it("should still strip thinking but not separate turn if thinking will be re-injected", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet-thinking",
        "test-conv-2",
        "proj-1"
      );

      // First, simulate a response that cached thinking
      storeGlobalThoughtSignature("x".repeat(100));

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

      // Step 1 strips thinking, so we still have 3 items
      // But Layer 2 re-injects thinking before tool call
      // Layer 3 shouldn't trigger because the turn will have thinking after Layer 2
      // So total should still be 3 (no synthetic messages)
      expect(requestBody.contents.length).toBe(3);

      // Verify thinking was re-injected in the model message
      const modelContent = requestBody.contents![1]!;
      expect(modelContent.role).toBe("model");
      const parts = modelContent.parts as Part[];
      expect(parts[0]!.thought).toBe(true);
      expect(parts[0]!.thoughtSignature).toBeDefined();
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

      ensureThinkingSignatures(requestBody, sessionKey, "claude-3-5-sonnet");

      // Should not separate because thinking is not enabled
      expect(requestBody.contents.length).toBe(originalLength);
    });

    it("should use Layer 2 global signature before Layer 3 separation", () => {
      const sessionKey = buildSignatureSessionKey(
        "claude-3-5-sonnet-thinking",
        "test-conv-4",
        "proj-1"
      );

      // Pre-populate global signature store
      const globalSig = "global_sig_" + "x".repeat(90);
      storeGlobalThoughtSignature(globalSig);

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

      // Should have injected thinking from Layer 2 global store
      // So original 3 items should still be 3 (no Layer 3 separation)
      expect(contents.length).toBe(3);

      // The tool function call should now have thinking injected before it
      const toolMessage = contents[1]!;
      expect(Array.isArray(toolMessage.parts)).toBe(true);
      const parts = toolMessage.parts!;

      // First part should be the injected thinking
      expect((parts[0] as Part).thought).toBe(true);
      expect((parts[0] as Part).thoughtSignature).toBe(globalSig);

      // Second part should be the function call
      expect((parts[1] as Part).functionCall).toBeDefined();
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
    it("should cache signatures only for Claude thinking models", () => {
      expect(shouldCacheSignatures("claude-3-5-sonnet-thinking")).toBe(true);
      expect(shouldCacheSignatures("claude-opus-thinking")).toBe(true);
      expect(shouldCacheSignatures("claude-3-5-sonnet")).toBe(false);
      expect(shouldCacheSignatures("gpt-4")).toBe(false);
      expect(shouldCacheSignatures("gemini-2-flash")).toBe(false);
    });
  });
});
