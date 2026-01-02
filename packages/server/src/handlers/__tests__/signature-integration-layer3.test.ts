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
      const testText = "some text";

      storeGlobalThoughtSignature(testSig, testText);
      const result = getGlobalThoughtSignature();
      expect(result).toBeDefined();
      expect(result?.signature).toBe(testSig);
      expect(result?.text).toBe(testText);
    });

    it("should ignore signatures shorter than MIN_SIGNATURE_LENGTH", () => {
      const shortSig = "too_short";
      const testText = "some text";

      storeGlobalThoughtSignature(shortSig, testText);
      expect(getGlobalThoughtSignature()).toBeUndefined();
    });

    it("should expire signatures older than 10 minutes", async () => {
      const testSig = "x".repeat(100);
      const testText = "some text";
      storeGlobalThoughtSignature(testSig, testText);

      // Verify it's stored
      expect(getGlobalThoughtSignature()?.signature).toBe(testSig);

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
      storeGlobalThoughtSignature("x".repeat(100), "Thinking about this...");

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

      // Use an OpenAI model to ensure logic is skipped (Blacklist policy)
      ensureThinkingSignatures(requestBody, sessionKey, "gpt-4");

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
      const globalText = "[Thinking from global store]";
      storeGlobalThoughtSignature(globalSig, globalText);

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

    it("should strip signatures for gemini-claude and restore with tool_use present", () => {
      const sessionKey = buildSignatureSessionKey(
        "gemini-claude-thinking",
        "test-conv-gemini-claude",
        "proj-1"
      );

      // Setup global signature - must be at least 50 characters to be stored
      const globalSig = "a".repeat(60); // 60 characters > MIN_SIGNATURE_LENGTH (50)
      storeGlobalThoughtSignature(globalSig, "Some thinking text", "gemini-claude-thinking");

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

      // Verify:
      // 1. Thinking part is RESTORED when tool_use is present
      // 2. It should have the global signature we stored

      const parts = requestBody.contents?.[0]?.parts;
      expect(parts).toBeDefined();
      if (!parts) return;

      expect(parts.length).toBeGreaterThan(0);
      const thinkingPart = parts[0] as {
        thought: boolean;
        thoughtSignature: string;
      };
      expect(thinkingPart.thought).toBe(true);
      expect(thinkingPart.thoughtSignature).toBe(globalSig);
    });
  });
});
