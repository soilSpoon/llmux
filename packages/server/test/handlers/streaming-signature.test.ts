import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SignatureStore } from "../../src/stores/signature-store";
import { saveSignaturesFromResponse, type SignatureContext } from "../../src/handlers/signature-response";
import { validateAndStripSignatures } from "../../src/handlers/signature-request";
import { unlinkSync, existsSync } from "node:fs";

describe("Streaming Signature Integration", () => {
  let store: SignatureStore;
  const testDbPath = "/tmp/test-streaming-signature.db";

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

  describe("full flow: response → save → request validation", () => {
    test("should save signature from response and validate in next request", () => {
      // Step 1: Response comes in with signature
      const responseSSE = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Thinking...","thoughtSignature":"flow_test_sig_123"}]}}]}}`;
      const responseContext: SignatureContext = {
        projectId: "projectA",
        provider: "antigravity",
        endpoint: "daily",
        account: "account1@example.com",
      };

      const savedCount = saveSignaturesFromResponse(responseSSE, responseContext, store);
      expect(savedCount).toBe(1);

      // Step 2: Next request comes with saved signature, same project
      const nextRequestContents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Thinking...",
              thoughtSignature: "flow_test_sig_123",
            },
          ],
        },
        {
          role: "user",
          parts: [{ text: "Continue please" }],
        },
      ];

      const result = validateAndStripSignatures({
        contents: nextRequestContents,
        targetProjectId: "projectA",
        signatureStore: store,
      });

      // Signature should be preserved (same project)
      expect(result.strippedCount).toBe(0);
      expect(result.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe("flow_test_sig_123");
    });

    test("should strip signature when project changes in next request", () => {
      // Step 1: Response from projectA
      const responseSSE = `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"project_change_sig"}]}}]}}`;
      saveSignaturesFromResponse(
        responseSSE,
        {
          projectId: "projectA",
          provider: "antigravity",
          endpoint: "daily",
          account: "account1@example.com",
        },
        store
      );

      // Step 2: Request goes to projectB (different project)
      const contents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Previous thinking",
              thoughtSignature: "project_change_sig",
            },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      // Signature should be stripped (different project)
      expect(result.strippedCount).toBe(1);
      expect(result.contents?.[0]?.parts?.[0]?.thoughtSignature).toBeUndefined();
      expect(result.contents?.[0]?.parts?.[0]?.thought).toBe(true);
      expect(result.contents?.[0]?.parts?.[0]?.text).toBe("Previous thinking");
    });
  });

  describe("429 fallback scenario: different project", () => {
    test("should strip signature when 429 causes fallback to different project", () => {
      // Scenario:
      // 1. Request to projectA succeeds → signature saved
      // 2. Next request: projectA returns 429 → fallback to projectB
      // 3. projectA's signature should be removed before sending to projectB

      // Step 1: First request to projectA succeeds
      const firstResponseSSE = `data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Initial thinking","thoughtSignature":"projectA_sig_429"}]}}]}}`;
      saveSignaturesFromResponse(
        firstResponseSSE,
        {
          projectId: "projectA",
          provider: "antigravity",
          endpoint: "daily",
          account: "accountA@example.com",
        },
        store
      );

      // Verify signature is saved for projectA
      expect(store.isValidForProject("projectA_sig_429", "projectA")).toBe(true);
      expect(store.isValidForProject("projectA_sig_429", "projectB")).toBe(false);

      // Step 2: Next request - projectA returns 429, fallback to projectB
      const fallbackRequestContents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Initial thinking",
              thoughtSignature: "projectA_sig_429",
            },
          ],
        },
        {
          role: "user",
          parts: [{ text: "Continue" }],
        },
      ];

      // Validate for projectB (the fallback project)
      const result = validateAndStripSignatures({
        contents: fallbackRequestContents,
        targetProjectId: "projectB",
        signatureStore: store,
      });

      // Signature from projectA should be stripped
      expect(result.strippedCount).toBe(1);
      expect(result.contents?.[0]?.parts?.[0]?.thoughtSignature).toBeUndefined();
      expect(result.contents?.[0]?.parts?.[0]?.thought).toBe(true);
      expect(result.contents?.[0]?.parts?.[0]?.text).toBe("Initial thinking");
    });

    test("should handle multiple signatures from different projects", () => {
      // Save signatures from different projects
      saveSignaturesFromResponse(
        `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"sigA"}]}}]}}`,
        { projectId: "projectA", provider: "antigravity", endpoint: "daily", account: "a@test.com" },
        store
      );
      saveSignaturesFromResponse(
        `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"sigB"}]}}]}}`,
        { projectId: "projectB", provider: "antigravity", endpoint: "prod", account: "b@test.com" },
        store
      );

      // Request with both signatures going to projectA
      const contents = [
        {
          role: "model",
          parts: [
            { thought: true, text: "From A", thoughtSignature: "sigA" },
            { thought: true, text: "From B", thoughtSignature: "sigB" },
          ],
        },
      ];

      const result = validateAndStripSignatures({
        contents,
        targetProjectId: "projectA",
        signatureStore: store,
      });

      // Only sigB should be stripped (from projectB)
      expect(result.strippedCount).toBe(1);
      const parts = result.contents?.[0]?.parts;
      expect(parts?.[0]?.thoughtSignature).toBe("sigA"); // Preserved
      expect(parts?.[1]?.thoughtSignature).toBeUndefined(); // Stripped
      expect(parts?.[1]?.thought).toBe(true);
      expect(parts?.[1]?.text).toBe("From B");
    });
  });

  describe("429 fallback scenario: same project, different endpoint", () => {
    test("should preserve signature when fallback to same project different endpoint", () => {
      // Scenario:
      // 1. Request to projectA/endpoint1 succeeds → signature saved
      // 2. Next request: projectA/endpoint1 returns 429 → fallback to projectA/endpoint2
      // 3. Since same projectId, signature should be maintained

      // Step 1: First request to projectA/endpoint1 succeeds
      const firstResponseSSE = `data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Endpoint1 thinking","thoughtSignature":"same_project_sig"}]}}]}}`;
      saveSignaturesFromResponse(
        firstResponseSSE,
        {
          projectId: "projectA",
          provider: "antigravity",
          endpoint: "daily", // endpoint1
          account: "accountA@example.com",
        },
        store
      );

      // Verify signature is saved
      expect(store.isValidForProject("same_project_sig", "projectA")).toBe(true);

      // Step 2: Fallback to projectA/endpoint2 (same project, different endpoint)
      const fallbackRequestContents = [
        {
          role: "model",
          parts: [
            {
              thought: true,
              text: "Endpoint1 thinking",
              thoughtSignature: "same_project_sig",
            },
          ],
        },
      ];

      // Validate for projectA (same project)
      const result = validateAndStripSignatures({
        contents: fallbackRequestContents,
        targetProjectId: "projectA", // Same project!
        signatureStore: store,
      });

      // Signature should be preserved (same project)
      expect(result.strippedCount).toBe(0);
      expect(result.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe("same_project_sig");
    });

    test("should preserve signature across multiple same-project fallbacks", () => {
      // Save signature for projectA
      saveSignaturesFromResponse(
        `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"multi_fallback_sig"}]}}]}}`,
        {
          projectId: "projectA",
          provider: "antigravity",
          endpoint: "daily",
          account: "account1@example.com",
        },
        store
      );

      // Fallback 1: endpoint2 of same project
      const result1 = validateAndStripSignatures({
        contents: [
          {
            role: "model",
            parts: [{ thought: true, text: "T", thoughtSignature: "multi_fallback_sig" }],
          },
        ],
        targetProjectId: "projectA",
        signatureStore: store,
      });
      expect(result1.strippedCount).toBe(0);
      expect(result1.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe("multi_fallback_sig");

      // Fallback 2: endpoint3 of same project
      const result2 = validateAndStripSignatures({
        contents: [
          {
            role: "model",
            parts: [{ thought: true, text: "T", thoughtSignature: "multi_fallback_sig" }],
          },
        ],
        targetProjectId: "projectA",
        signatureStore: store,
      });
      expect(result2.strippedCount).toBe(0);
      expect(result2.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe("multi_fallback_sig");
    });
  });

  describe("SignatureStore singleton/DI pattern", () => {
    test("should share state across multiple operations with same store", () => {
      // This tests that DI pattern works correctly
      const context: SignatureContext = {
        projectId: "shared-project",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      };

      // Save via response handler
      saveSignaturesFromResponse(
        `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"shared_sig"}]}}]}}`,
        context,
        store
      );

      // Validate via request handler using same store
      const result = validateAndStripSignatures({
        contents: [
          {
            role: "model",
            parts: [{ thoughtSignature: "shared_sig" }],
          },
        ],
        targetProjectId: "shared-project",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
    });

    test("should isolate state between different store instances", () => {
      const store2 = new SignatureStore(); // In-memory, separate instance

      // Save to store1
      saveSignaturesFromResponse(
        `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"isolated_sig"}]}}]}}`,
        {
          projectId: "projectA",
          provider: "antigravity",
          endpoint: "daily",
          account: "test@example.com",
        },
        store
      );

      // Validate with store2 (separate instance) - signature not found
      const result = validateAndStripSignatures({
        contents: [
          {
            role: "model",
            parts: [{ thoughtSignature: "isolated_sig" }],
          },
        ],
        targetProjectId: "projectA",
        signatureStore: store2,
      });

      // Should strip because store2 doesn't have the signature
      expect(result.strippedCount).toBe(1);

      store2.close();
    });
  });

  describe("Anthropic messages format integration", () => {
    test("should save and validate signatures in messages format", () => {
      // Save from Anthropic-style response
      saveSignaturesFromResponse(
        `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"anthropic_msg_sig"}}`,
        {
          projectId: "anthropic-project",
          provider: "anthropic",
          endpoint: "prod",
          account: "anthropic@test.com",
        },
        store
      );

      // Validate in messages format
      const result = validateAndStripSignatures({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Previous thought",
                signature: "anthropic_msg_sig",
              },
            ],
          },
        ],
        targetProjectId: "anthropic-project",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(0);
    });

    test("should strip Anthropic signature when project mismatch", () => {
      // Save for projectA
      saveSignaturesFromResponse(
        `data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"anthropic_delta_sig"}}`,
        {
          projectId: "projectA",
          provider: "anthropic",
          endpoint: "prod",
          account: "anthropic@test.com",
        },
        store
      );

      // Validate for projectB
      const result = validateAndStripSignatures({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Some thought",
                signature: "anthropic_delta_sig",
              },
            ],
          },
        ],
        targetProjectId: "projectB",
        signatureStore: store,
      });

      expect(result.strippedCount).toBe(1);
      const block = result.messages?.[0]?.content?.[0] as Record<string, unknown>;
      expect(block.signature).toBeUndefined();
      expect(block.thinking).toBe("Some thought");
    });
  });

  describe("edge cases in integration", () => {
    test("should handle unregistered signature gracefully", () => {
      // Request with signature that was never saved
      const result = validateAndStripSignatures({
        contents: [
          {
            role: "model",
            parts: [{ thought: true, text: "T", thoughtSignature: "never_saved_sig" }],
          },
        ],
        targetProjectId: "anyProject",
        signatureStore: store,
      });

      // Should strip unregistered signatures
      expect(result.strippedCount).toBe(1);
      expect(result.contents?.[0]?.parts?.[0]?.thoughtSignature).toBeUndefined();
    });

    test("should handle mixed registered and unregistered signatures", () => {
      saveSignaturesFromResponse(
        `data: {"response":{"candidates":[{"content":{"parts":[{"thoughtSignature":"registered_sig"}]}}]}}`,
        {
          projectId: "projectA",
          provider: "antigravity",
          endpoint: "daily",
          account: "test@example.com",
        },
        store
      );

      const result = validateAndStripSignatures({
        contents: [
          {
            role: "model",
            parts: [
              { thought: true, text: "Registered", thoughtSignature: "registered_sig" },
              { thought: true, text: "Not registered", thoughtSignature: "unregistered_sig" },
            ],
          },
        ],
        targetProjectId: "projectA",
        signatureStore: store,
      });

      // Only unregistered should be stripped
      expect(result.strippedCount).toBe(1);
      const parts = result.contents?.[0]?.parts;
      expect(parts?.[0]?.thoughtSignature).toBe("registered_sig");
      expect(parts?.[1]?.thoughtSignature).toBeUndefined();
    });
  });
});
