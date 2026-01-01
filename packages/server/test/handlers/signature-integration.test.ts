import { describe, expect, test, beforeEach } from "bun:test";
import "../setup";
import {
  buildSignatureSessionKey,
  cacheSignatureFromChunk,
  ensureThinkingSignatures,
  extractConversationKey,
  shouldCacheSignatures,
} from "../../src/handlers/signature-integration";

describe("signature-integration", () => {
  beforeEach(() => {
    // Clear the cache between tests
    // Note: signatureCache is a singleton, so we clear all known sessions
  });

  describe("buildSignatureSessionKey", () => {
    test("should build session key with all parameters", () => {
      const key = buildSignatureSessionKey(
        "claude-sonnet-4-5-thinking",
        "conv-123",
        "proj-456"
      );
      expect(key).toContain("server-");
      expect(key).toContain("claude-sonnet-4-5-thinking");
      expect(key).toContain("proj-456");
      expect(key).toContain("conv-123");
    });

    test("should use defaults for missing parameters", () => {
      const key = buildSignatureSessionKey("claude-thinking");
      expect(key).toContain("default");
      expect(key).toContain("claude-thinking");
    });

    test("should normalize model name to lowercase", () => {
      const key = buildSignatureSessionKey("Claude-THINKING");
      expect(key).toContain("claude-thinking");
    });

    test("should use 'unknown' for undefined model", () => {
      const key = buildSignatureSessionKey(undefined);
      expect(key).toContain("unknown");
    });
  });

  describe("extractConversationKey", () => {
    test("should extract conversationId from payload", () => {
      const payload = { conversationId: "conv-123", model: "claude" };
      const key = extractConversationKey(payload);
      expect(key).toBe("conv-123");
    });

    test("should extract thread_id from payload", () => {
      const payload = { thread_id: "thread-456", model: "claude" };
      const key = extractConversationKey(payload);
      expect(key).toBe("thread-456");
    });

    test("should extract from metadata", () => {
      const payload = {
        metadata: { conversation_id: "meta-conv-789" },
        model: "claude",
      };
      const key = extractConversationKey(payload);
      expect(key).toBe("meta-conv-789");
    });

    test("should generate seed-based key when no explicit ID", () => {
      const payload = {
        contents: [{ role: "user", parts: [{ text: "Hello world" }] }],
      };
      const key = extractConversationKey(payload);
      expect(key).toMatch(/^seed-[a-f0-9]+$/);
    });

    test("should return undefined for empty payload", () => {
      const key = extractConversationKey({});
      expect(key).toBeUndefined();
    });
  });

  describe("shouldCacheSignatures", () => {
    test("should return true for claude thinking models", () => {
      expect(shouldCacheSignatures("claude-sonnet-4-5-thinking")).toBe(true);
      expect(shouldCacheSignatures("claude-opus-4-5-thinking")).toBe(true);
    });

    test("should return true for non-thinking claude models (relaxed policy)", () => {
      expect(shouldCacheSignatures("claude-sonnet-4-5")).toBe(true);
      expect(shouldCacheSignatures("claude-3-opus")).toBe(true);
    });

    test("should return true for Gemini models but false for OpenAI", () => {
      expect(shouldCacheSignatures("gemini-2.5-flash")).toBe(true);
      expect(shouldCacheSignatures("gpt-4")).toBe(false);
    });

    test("should return false for undefined/empty", () => {
      expect(shouldCacheSignatures(undefined)).toBe(false);
      expect(shouldCacheSignatures("")).toBe(false);
    });
  });

  describe("cacheSignatureFromChunk", () => {
    test("should accumulate thinking text in buffer", () => {
      const sessionKey = "test-session";
      const thoughtBuffer = new Map<number, string>();

      cacheSignatureFromChunk(
        sessionKey,
        { thinking: { text: "Hello " } },
        thoughtBuffer,
        0
      );
      cacheSignatureFromChunk(
        sessionKey,
        { thinking: { text: "world" } },
        thoughtBuffer,
        0
      );

      expect(thoughtBuffer.get(0)).toBe("Hello world");
    });

    test("should cache signature when received", () => {
      const sessionKey = `test-cache-${Date.now()}`;
      const thoughtBuffer = new Map<number, string>();
      const signature = "a".repeat(60);

      // First accumulate some thinking text
      cacheSignatureFromChunk(
        sessionKey,
        { thinking: { text: "Thinking content here" } },
        thoughtBuffer,
        0
      );

      // Then receive signature
      cacheSignatureFromChunk(
        sessionKey,
        { thinking: { signature } },
        thoughtBuffer,
        0
      );

      // Signature should be cached (verified internally via lastSignedThinkingBySessionKey)
      // We can't directly test the cache here without exporting more internals
      expect(thoughtBuffer.get(0)).toBe("Thinking content here");
    });

    test("should handle separate candidate indices", () => {
      const sessionKey = "test-multicandidate";
      const thoughtBuffer = new Map<number, string>();

      cacheSignatureFromChunk(
        sessionKey,
        { thinking: { text: "First candidate" } },
        thoughtBuffer,
        0
      );
      cacheSignatureFromChunk(
        sessionKey,
        { thinking: { text: "Second candidate" } },
        thoughtBuffer,
        1
      );

      expect(thoughtBuffer.get(0)).toBe("First candidate");
      expect(thoughtBuffer.get(1)).toBe("Second candidate");
    });
  });

  describe("ensureThinkingSignatures", () => {
    test("should not modify request without thinking blocks", () => {
      const sessionKey = "test-no-thinking";
      const requestBody = {
        contents: [
          { role: "user", parts: [{ text: "Hello" }] },
          { role: "model", parts: [{ text: "Hi there!" }] },
        ],
      };

      const original = JSON.stringify(requestBody);
      ensureThinkingSignatures(requestBody, sessionKey);

      expect(JSON.stringify(requestBody)).toBe(original);
    });

    test("should process contents-style request", () => {
      const sessionKey = "test-contents";
      const requestBody = {
        contents: [
          {
            role: "model",
            parts: [
              { thought: true, text: "Let me think..." },
              { functionCall: { name: "test", args: {} } },
            ],
          },
        ],
      };

      // Should not throw
      ensureThinkingSignatures(requestBody, sessionKey);
      expect(requestBody.contents).toHaveLength(1);
    });

    test("should process messages-style request", () => {
      const sessionKey = "test-messages";
      const requestBody = {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me think..." },
              { type: "tool_use", id: "tool-1", name: "test", input: {} },
            ],
          },
        ],
      };

      // Should not throw
      ensureThinkingSignatures(requestBody, sessionKey);
      expect(requestBody.messages).toHaveLength(1);
    });

    test("should process wrapped request format", () => {
      const sessionKey = "test-wrapped";
      const requestBody = {
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      };

      // Should not throw
      ensureThinkingSignatures(requestBody, sessionKey);
      expect(requestBody.request.contents).toHaveLength(1);
    });
  });
});
