import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SignatureStore } from "../../src/stores/signature-store";
import { validateAndStripSignatures, type Part, type Block } from "../../src/handlers/signature-request";
import { unlinkSync, existsSync } from "node:fs";

describe("Signature Request Processing", () => {
  let store: SignatureStore;
  const testDbPath = "/tmp/test-signature-request.db";

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    store = new SignatureStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe("signature validation with contents (Gemini format)", () => {
    test("should keep signature when same project", () => {
      store.saveSignature({
        signature: "sig_project_a",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Let me think...",
              thoughtSignature: "sig_project_a",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectA",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.thoughtSignature).toBe("sig_project_a");
    });

    test("should strip signature when different project", () => {
      store.saveSignature({
        signature: "sig_project_a",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Let me think...",
              thoughtSignature: "sig_project_a",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.thoughtSignature).toBeUndefined();
      expect(part.thought).toBe(true);
      expect(part.text).toBe("Let me think...");
    });

    test("should strip signature when not registered in DB", () => {
      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Unregistered thinking...",
              thoughtSignature: "unknown_sig",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.thoughtSignature).toBeUndefined();
      expect(part.thought).toBe(true);
      expect(part.text).toBe("Unregistered thinking...");
    });

    test("should always preserve thought and text fields", () => {
      store.saveSignature({
        signature: "sig1",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Important thinking content",
              thoughtSignature: "sig1",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.thought).toBe(true);
      expect(part.text).toBe("Important thinking content");
    });

    test("should strip only mismatched signatures in multiple parts", () => {
      store.saveSignature({
        signature: "sig_valid",
        projectId: "targetProject",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });
      store.saveSignature({
        signature: "sig_invalid",
        projectId: "otherProject",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Valid thinking",
              thoughtSignature: "sig_valid",
            },
            {
              thought: true,
              text: "Invalid thinking",
              thoughtSignature: "sig_invalid",
            },
            {
              text: "Regular text, no signature",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "targetProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const parts = result.contents![0]!.parts as Part[];
      expect(parts[0]!.thoughtSignature).toBe("sig_valid");
      expect(parts[1]!.thoughtSignature).toBeUndefined();
      expect(parts[1]!.thought).toBe(true);
      expect(parts[1]!.text).toBe("Invalid thinking");
      expect(parts[2]!.text).toBe("Regular text, no signature");
    });

    test("should handle thought_signature (snake_case) format", () => {
      store.saveSignature({
        signature: "snake_sig",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Snake case thinking",
              thought_signature: "snake_sig",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.thought_signature).toBeUndefined();
      expect(part.thought).toBe(true);
    });

    test("should handle signature field (Anthropic format)", () => {
      store.saveSignature({
        signature: "anthropic_sig",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Anthropic thinking",
              signature: "anthropic_sig",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.signature).toBeUndefined();
    });
  });

  describe("signature validation with messages (Anthropic/OpenAI format)", () => {
    test("should keep signature when same project", () => {
      store.saveSignature({
        signature: "msg_sig",
        projectId: "projectA",
        provider: "anthropic",
        endpoint: "prod",
        account: "test@example.com",
      });

      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Deep thoughts...",
              signature: "msg_sig",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        messages,
        targetProjectId: "projectA",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      const content = result.messages![0]!.content as Block[];
      expect(content[0]!.signature).toBe("msg_sig");
    });

    test("should strip signature when different project", () => {
      store.saveSignature({
        signature: "msg_sig_invalid",
        projectId: "projectA",
        provider: "anthropic",
        endpoint: "prod",
        account: "test@example.com",
      });

      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Deep thoughts...",
              signature: "msg_sig_invalid",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        messages,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const content = result.messages![0]!.content as Block[];
      expect(content[0]!.signature).toBeUndefined();
      expect(content[0]!.thinking).toBe("Deep thoughts...");
      expect(content[0]!.type).toBe("thinking");
    });

    test("should handle string content in messages", () => {
      const messages = [
        {
          role: "user",
          content: "Hello, world!",
        },
      ];

      const result = validateAndStripSignatures({
        messages,
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      expect(result.messages?.[0]?.content).toBe("Hello, world!");
    });

    test("should strip thoughtSignature from message blocks", () => {
      store.saveSignature({
        signature: "block_sig",
        projectId: "projectA",
        provider: "openai",
        endpoint: "api",
        account: "test@example.com",
      });

      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              text: "Thinking...",
              thoughtSignature: "block_sig",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        messages,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const content = result.messages![0]!.content as Block[];
      expect(content[0]!.thoughtSignature).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("should handle empty contents array", () => {
      const result = validateAndStripSignatures({
        contents: [],
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      expect(result.contents).toEqual([]);
    });

    test("should handle empty messages array", () => {
      const result = validateAndStripSignatures({
        messages: [],
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      expect(result.messages).toEqual([]);
    });

    test("should handle undefined contents and messages", () => {
      const result = validateAndStripSignatures({
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      expect(result.contents).toBeUndefined();
      expect(result.messages).toBeUndefined();
    });

    test("should handle parts without signature fields", () => {
      const contents = [
        {
          role: "model",
          parts: [
            { text: "Just text" },
            { functionCall: { name: "test" } },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
      const part = result.contents?.[0]?.parts?.[0] as Part;
      expect(part.text).toBe("Just text");
    });

    test("should handle null/undefined parts gracefully", () => {
      const contents = [
        {
          role: "model",
          parts: undefined,
        },
        {
          role: "user",
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
    });

    test("should preserve all other fields in parts", () => {
      store.saveSignature({
        signature: "complex_sig",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Thinking...",
              thoughtSignature: "complex_sig",
              customField: "preserved",
              anotherField: 123,
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      const part = result.contents?.[0]?.parts?.[0] as Part & { customField: string; anotherField: number };
      expect(part.thoughtSignature).toBeUndefined();
      expect(part.customField).toBe("preserved");
      expect(part.anotherField).toBe(123);
    });
  });

  describe("logging behavior", () => {
    test("should return correct stripped count", () => {
      store.saveSignature({
        signature: "log_sig_1",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });
      store.saveSignature({
        signature: "log_sig_2",
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const contents = [
        {
          role: "model",
          parts: [
            { thought: true, text: "T1", thoughtSignature: "log_sig_1" },
            { thought: true, text: "T2", thoughtSignature: "log_sig_2" },
            { thought: true, text: "T3", thoughtSignature: "unknown_sig" },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(3);
    });
  });
});
