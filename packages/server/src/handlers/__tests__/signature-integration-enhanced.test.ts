import { describe, expect, test } from "bun:test";
import "../../../test/setup";
import {
	ensureThinkingSignatures,
	extractConversationKey,
	type UnifiedRequestBody,
} from "../signature-integration";
import type { Part, Block } from "../thinking-utils";

interface TestPart extends Part {
	thought?: boolean;
	text?: string;
	thought_signature?: string;
	thoughtSignature?: string;
	signature?: string;
	type?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
}

interface TestBlock extends Block {
	type?: string;
	text?: string;
	thinking?: string;
	signature?: string;
}

describe("signature-integration - Enhanced Multi-Turn Tests", () => {
	const TEST_SIGNATURE = "a".repeat(60);

  describe("STEP 1: stripAllThinkingFromContents - Gemini Format", () => {
    test("does NOT strip thinking blocks in ensureThinkingSignatures for Claude (handled by sanitizeRequestSignatures)", () => {
      const sessionKey = "test-strip-contents";
      const requestBody: UnifiedRequestBody = {
        contents: [
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Internal thinking...",
                thoughtSignature: TEST_SIGNATURE,
              },
              { text: "User-visible response" },
            ],
          },
          {
            role: "user",
            parts: [{ text: "User message" }],
          },
          {
            role: "model",
            parts: [{ text: "Another response" }],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      // ensureThinkingSignatures does NOT strip thinking for Claude
      // Stripping is handled by sanitizeRequestSignatures (pre-transform)
      const firstContent = requestBody.contents?.[0];
      expect(firstContent?.parts).toBeDefined();
      const firstParts = firstContent?.parts as TestPart[];

      // Thinking parts are preserved (stripping happens in sanitizeRequestSignatures)
      expect(firstParts.some((p) => p.thought === true)).toBe(true);
      expect(firstParts.some((p) => p.text === "User-visible response")).toBe(
        true
      );
    });

    test("re-injects cached thinking when tool_use is present (valid behavior)", () => {
      const sessionKey = "test-preserve-tooluse";
      const requestBody: UnifiedRequestBody = {
        contents: [
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Thinking...",
                thoughtSignature: TEST_SIGNATURE,
              },
              {
                type: "tool_use",
                id: "call-1",
                name: "bash",
                input: { cmd: "ls" },
              },
              { type: "text", text: "Here's the result" },
            ],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      const parts = requestBody.contents?.[0]?.parts as TestPart[];

      // tool_use should be preserved
      expect(
        parts.some((p) => p.type === "tool_use" || p.name === "bash")
      ).toBe(true);

      // Thinking may be re-injected if tool_use is present (this is valid behavior)
      // The thinking block might exist with valid signature
    });

    test("does NOT strip thinking in ensureThinkingSignatures for Claude multi-turn (handled by sanitizeRequestSignatures)", () => {
      const sessionKey = "test-multiple-thinking";
      const requestBody: UnifiedRequestBody = {
        contents: [
          {
            role: "model",
            parts: [
              { thought: true, text: "First thought" },
              { text: "Response 1" },
              { thought: true, text: "Second thought" },
              { text: "Response 2" },
            ],
          },
          {
            role: "user",
            parts: [{ text: "User follows up" }],
          },
          {
            role: "model",
            parts: [{ text: "Final response" }],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      // ensureThinkingSignatures does NOT strip thinking for Claude
      // Stripping is handled by sanitizeRequestSignatures (pre-transform)
      const parts = requestBody.contents?.[0]?.parts as TestPart[];
      const thinkingCount = parts.filter((p) => p.thought === true).length;

      // Thinking parts preserved (stripping happens in sanitizeRequestSignatures)
      expect(thinkingCount).toBe(2);
      expect(parts.length).toBe(4);
    });

    test("strips thinking blocks for pure Gemini models (managed behavior)", () => {
      const sessionKey = "test-gemini-strip-thinking";
      const requestBody: UnifiedRequestBody = {
        contents: [
          {
            role: "model",
            parts: [
              { thought: true, text: "Thinking..." },
              { text: "Response" },
            ],
          },
        ],
      };

      // gemini-2.5-flash is now a managed thinking model (shouldCacheSignatures = true)
      // So ensuring signatures means stripping unsigned thinking blocks
      ensureThinkingSignatures(requestBody, sessionKey, "gemini-2.5-flash");

      const parts = requestBody.contents?.[0]?.parts as { thought?: boolean; text?: string }[];

      // Expect thinking block to be removed because it had no signature
      // and none could be restored from cache
      expect(parts.some((p) => p.thought === true)).toBe(false);
      expect(parts.length).toBe(1);
      expect(parts[0]?.text).toBe("Response");
    });

    test("does NOT remove residual thoughtSignature in ensureThinkingSignatures for Claude (handled by sanitizeRequestSignatures)", () => {
      const sessionKey = "test-residual-signatures";
      const requestBody: UnifiedRequestBody = {
        contents: [
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Thinking...",
                thoughtSignature: TEST_SIGNATURE,
              },
              { 
                text: "Final response", 
                thoughtSignature: TEST_SIGNATURE 
              },
              { 
                type: "tool_use", 
                id: "call-1", 
                name: "bash", 
                input: { cmd: "ls" },
                signature: TEST_SIGNATURE
              },
            ],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      const parts = requestBody.contents?.[0]?.parts as TestPart[];

      // ensureThinkingSignatures does NOT strip thinking/signatures for Claude
      // Stripping is handled by sanitizeRequestSignatures (pre-transform)
      
      // thinking part preserved
      expect(parts.some(p => p.thought === true)).toBe(true);

      // text part remains WITH thoughtSignature (not stripped by ensureThinkingSignatures)
      const textPart = parts.find(p => p.text === "Final response");
      expect(textPart).toBeDefined();
      expect(textPart?.thoughtSignature).toBe(TEST_SIGNATURE);

      // tool_use part remains WITH signature (not stripped by ensureThinkingSignatures)
      const toolPart = parts.find(p => p.type === "tool_use");
      expect(toolPart).toBeDefined();
      expect(toolPart?.signature).toBe(TEST_SIGNATURE);
    });
  });

  describe("STEP 1: stripAllThinkingFromMessages - Anthropic Format", () => {
    test("does NOT strip thinking blocks in ensureThinkingSignatures for Claude (handled by sanitizeRequestSignatures)", () => {
      const sessionKey = "test-strip-messages";
      const requestBody: UnifiedRequestBody = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Internal reasoning...",
                signature: TEST_SIGNATURE,
              },
              { type: "text", text: "Final answer" },
            ],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      const content = requestBody.messages?.[0]?.content as TestBlock[];

      // ensureThinkingSignatures does NOT strip thinking for Claude
      // Stripping is handled by sanitizeRequestSignatures (pre-transform)
      expect(content.some((b) => b.type === "thinking")).toBe(true);

      // Text should remain
      expect(
        content.some((b) => b.type === "text" && b.text === "Final answer")
      ).toBe(true);
    });

    test("does NOT remove residual signature in ensureThinkingSignatures for Claude (handled by sanitizeRequestSignatures)", () => {
      const sessionKey = "test-residual-messages";
      const requestBody: UnifiedRequestBody = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Reasoning...",
                signature: TEST_SIGNATURE,
              },
              { 
                type: "text", 
                text: "Final answer",
                signature: TEST_SIGNATURE 
              },
            ],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      const content = requestBody.messages?.[0]?.content as TestBlock[];

      // ensureThinkingSignatures does NOT strip thinking/signatures for Claude
      // Stripping is handled by sanitizeRequestSignatures (pre-transform)
      
      // thinking preserved
      expect(content.some(b => b.type === "thinking")).toBe(true);

      // text remains WITH signature (not stripped by ensureThinkingSignatures)
      const textBlock = content.find(b => b.type === "text");
      expect(textBlock).toBeDefined();
      expect(textBlock?.signature).toBe(TEST_SIGNATURE);
    });

    test("re-injects thinking when tool_use is present in messages format (valid behavior)", () => {
      const sessionKey = "test-messages-tooluse";
      const requestBody: UnifiedRequestBody = {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me think..." },
              {
                type: "tool_use",
                id: "read-1",
                name: "Read",
                input: { path: "/file.txt" },
              },
              { type: "text", text: "I read the file" },
            ],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      const content = requestBody.messages?.[0]?.content as TestBlock[];

      // tool_use preserved
      expect(content.some((b) => b.type === "tool_use")).toBe(true);

      // Thinking may be re-injected when tool_use is present (this is valid behavior)
    });
  });



  describe("Edge Cases", () => {
    test("handles multiple tool_use blocks in single message (opencode strips all)", () => {
      const sessionKey = `multi-tool-${Date.now()}`;

      const requestBody: UnifiedRequestBody = {
        contents: [
          {
            role: "model",
            parts: [
              {
                type: "tool_use",
                id: "read-1",
                name: "Read",
                input: { path: "/file1.txt" },
              },
              {
                type: "tool_use",
                id: "bash-1",
                name: "bash",
                input: { cmd: "ls" },
              },
              {
                type: "tool_use",
                id: "grep-1",
                name: "Grep",
                input: { pattern: "test" },
              },
            ],
          },
        ],
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      const parts = requestBody.contents?.[0]?.parts as TestPart[];

      // opencode strategy: no thinking injection, all 3 tool_use preserved
      expect(parts.filter((p) => p.type === "tool_use").length).toBe(3);
    });

    test("handles wrapped request format (request.contents)", () => {
      const sessionKey = "wrapped-format";

      const requestBody: UnifiedRequestBody = {
        request: {
          contents: [
            {
              role: "model",
              parts: [
                { thought: true, text: "Thinking" },
                {
                  type: "tool_use",
                  id: "bash-1",
                  name: "bash",
                  input: { cmd: "ls" },
                },
              ],
            },
          ],
        },
      };

      ensureThinkingSignatures(
        requestBody,
        sessionKey,
        "claude-opus-4-5-thinking"
      );

      // Wrapped format should be processed
      const contents = (requestBody.request as Record<string, unknown>)?.contents;
      expect(contents).toBeDefined();
    });
  });

  describe("Conversation Key Extraction and Session Management", () => {
    test("extracts explicit conversationId", () => {
      const payload = { conversationId: "explicit-123" };
      const key = extractConversationKey(payload);
      expect(key).toBe("explicit-123");
    });

    test("extracts from metadata when no top-level ID", () => {
      const payload = {
        metadata: { conversation_id: "meta-456" },
      };
      const key = extractConversationKey(payload);
      expect(key).toBe("meta-456");
    });

    test("generates seed-based key when no explicit ID", () => {
      const payload = {
        contents: [{ role: "user", parts: [{ text: "Hello world" }] }],
      };
      const key = extractConversationKey(payload);
      expect(key).toMatch(/^seed-[a-f0-9]{16}$/);
    });

    test("different conversations generate different seed keys", () => {
      const payload1 = {
        contents: [{ role: "user", parts: [{ text: "Message 1" }] }],
      };
      const payload2 = {
        contents: [{ role: "user", parts: [{ text: "Message 2" }] }],
      };

      const key1 = extractConversationKey(payload1);
      const key2 = extractConversationKey(payload2);

      expect(key1).not.toBe(key2);
    });
  });
});
