import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SignatureStore } from "../../src/stores/signature-store";
import {
  extractSignaturesFromSSE,
  saveSignaturesFromResponse,
  type SignatureContext,
} from "../../src/handlers/signature-response";
import { unlinkSync, existsSync } from "node:fs";

describe("Signature Response Processing", () => {
  let store: SignatureStore;
  const testDbPath = "/tmp/test-signature-response.db";

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

  describe("extractSignaturesFromSSE", () => {
    test("should extract thoughtSignature from SSE response", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Let me think...","thoughtSignature":"ErADCq0DAXLI2nx123"}]}}]}}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(1);
      expect(signatures[0]).toBe("ErADCq0DAXLI2nx123");
    });

    test("should extract thought_signature (snake_case) from SSE response", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Thinking...","thought_signature":"snake_case_sig_456"}]}}]}}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(1);
      expect(signatures[0]).toBe("snake_case_sig_456");
    });

    test("should extract multiple signatures from response", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Part 1","thoughtSignature":"sig1"},{"thought":true,"text":"Part 2","thoughtSignature":"sig2"}]}}]}}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(2);
      expect(signatures).toContain("sig1");
      expect(signatures).toContain("sig2");
    });

    test("should return empty array when no signature present", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello world"}]}}]}}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(0);
    });

    test("should handle Anthropic format with signature in thinking block", () => {
      const sseData = `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"anthropic_sig_789"}}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(1);
      expect(signatures[0]).toBe("anthropic_sig_789");
    });

    test("should handle signature_delta events", () => {
      const sseData = `data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"delta_sig_abc"}}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(1);
      expect(signatures[0]).toBe("delta_sig_abc");
    });

    test("should deduplicate signatures", () => {
      const sseData1 = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"same_sig"}]}}]}}`;
      const sseData2 = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"same_sig"}]}}]}}`;

      const signatures1 = extractSignaturesFromSSE(sseData1);
      const signatures2 = extractSignaturesFromSSE(sseData2);
      const combined = [...new Set([...signatures1, ...signatures2])];

      expect(combined).toHaveLength(1);
    });

    test("should handle malformed JSON gracefully", () => {
      const sseData = `data: {invalid json}`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(0);
    });

    test("should handle [DONE] event", () => {
      const sseData = `data: [DONE]`;

      const signatures = extractSignaturesFromSSE(sseData);

      expect(signatures).toHaveLength(0);
    });
  });

  describe("saveSignaturesFromResponse", () => {
    const baseContext: SignatureContext = {
      projectId: "test-project-123",
      provider: "antigravity",
      endpoint: "daily",
      account: "test@example.com",
    };

    test("should save extracted signature to store", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"save_test_sig"}]}}]}}`;

      const saved = saveSignaturesFromResponse(sseData, baseContext, store);

      expect(saved).toBe(1);
      const record = store.getRecord("save_test_sig");
      expect(record).not.toBeNull();
      expect(record!.projectId).toBe("test-project-123");
      expect(record!.provider).toBe("antigravity");
      expect(record!.endpoint).toBe("daily");
      expect(record!.account).toBe("test@example.com");
    });

    test("should save signature with correct projectId", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"project_sig"}]}}]}}`;
      const context: SignatureContext = {
        ...baseContext,
        projectId: "firebase-project-abc",
      };

      saveSignaturesFromResponse(sseData, context, store);

      const record = store.getRecord("project_sig");
      expect(record!.projectId).toBe("firebase-project-abc");
    });

    test("should not save when no signature present", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"text":"No signature here"}]}}]}}`;

      const saved = saveSignaturesFromResponse(sseData, baseContext, store);

      expect(saved).toBe(0);
    });

    test("should save multiple signatures from response", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"multi_sig_1"},{"thoughtSignature":"multi_sig_2"},{"thoughtSignature":"multi_sig_3"}]}}]}}`;

      const saved = saveSignaturesFromResponse(sseData, baseContext, store);

      expect(saved).toBe(3);
      expect(store.getRecord("multi_sig_1")).not.toBeNull();
      expect(store.getRecord("multi_sig_2")).not.toBeNull();
      expect(store.getRecord("multi_sig_3")).not.toBeNull();
    });

    test("should handle thought_signature (snake_case) format", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thought_signature":"snake_sig"}]}}]}}`;

      const saved = saveSignaturesFromResponse(sseData, baseContext, store);

      expect(saved).toBe(1);
      expect(store.getRecord("snake_sig")).not.toBeNull();
    });

    test("should save provider, endpoint, account with signature", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"metadata_sig"}]}}]}}`;
      const context: SignatureContext = {
        projectId: "proj",
        provider: "openai",
        endpoint: "prod",
        account: "admin@company.com",
      };

      saveSignaturesFromResponse(sseData, context, store);

      const record = store.getRecord("metadata_sig");
      expect(record!.provider).toBe("openai");
      expect(record!.endpoint).toBe("prod");
      expect(record!.account).toBe("admin@company.com");
    });

    test("should skip empty or invalid signatures", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":""},{"thoughtSignature":"valid_sig"}]}}]}}`;

      const saved = saveSignaturesFromResponse(sseData, baseContext, store);

      expect(saved).toBe(1);
      expect(store.getRecord("valid_sig")).not.toBeNull();
    });

    test("should handle missing projectId gracefully", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"no_project_sig"}]}}]}}`;
      const context: SignatureContext = {
        projectId: "", // Empty projectId
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      };

      const saved = saveSignaturesFromResponse(sseData, context, store);

      // Should still save but with empty projectId (won't match any target project)
      expect(saved).toBe(1);
      const record = store.getRecord("no_project_sig");
      expect(record!.projectId).toBe("");
    });
  });

  describe("integration with accumulated SSE chunks", () => {
    const baseContext: SignatureContext = {
      projectId: "integration-project",
      provider: "antigravity",
      endpoint: "daily",
      account: "integration@test.com",
    };

    test("should process multiple SSE events and save all signatures", () => {
      const events = [
        `data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking 1","thoughtSignature":"chunk_sig_1"}]}}]}}`,
        `data: {"response":{"candidates":[{"content":{"parts":[{"text":"Regular text"}]}}]}}`,
        `data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking 2","thoughtSignature":"chunk_sig_2"}]}}]}}`,
        `data: [DONE]`,
      ];

      let totalSaved = 0;
      for (const event of events) {
        totalSaved += saveSignaturesFromResponse(event, baseContext, store);
      }

      expect(totalSaved).toBe(2);
      expect(store.getRecord("chunk_sig_1")).not.toBeNull();
      expect(store.getRecord("chunk_sig_2")).not.toBeNull();
    });

    test("should validate saved signatures against project", () => {
      const sseData = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"validate_sig"}]}}]}}`;

      saveSignaturesFromResponse(sseData, baseContext, store);

      // Same project - should be valid
      expect(store.isValidForProject("validate_sig", "integration-project")).toBe(true);
      // Different project - should be invalid
      expect(store.isValidForProject("validate_sig", "other-project")).toBe(false);
    });
  });
});
