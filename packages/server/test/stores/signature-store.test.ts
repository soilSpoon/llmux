import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SignatureStore } from "../../src/stores/signature-store";
import { unlinkSync, existsSync } from "node:fs";
import crypto from "node:crypto";

describe("SignatureStore", () => {
  let store: SignatureStore;
  const testDbPath = "/tmp/test-signature-store.db";

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

  describe("saveSignature", () => {
    test("should save signature with all fields", () => {
      const signature = "test-signature-abc123";
      store.saveSignature({
        signature,
        projectId: "project-1",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const record = store.getRecord(signature);
      expect(record).not.toBeNull();
      expect(record!.projectId).toBe("project-1");
      expect(record!.provider).toBe("antigravity");
      expect(record!.endpoint).toBe("daily");
      expect(record!.account).toBe("test@example.com");
    });

    test("should update existing signature on re-save", () => {
      const signature = "test-signature-update";
      store.saveSignature({
        signature,
        projectId: "project-1",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      store.saveSignature({
        signature,
        projectId: "project-2",
        provider: "openai",
        endpoint: "prod",
        account: "new@example.com",
      });

      const record = store.getRecord(signature);
      expect(record).not.toBeNull();
      expect(record!.projectId).toBe("project-2");
      expect(record!.provider).toBe("openai");
    });
  });

  describe("getRecord", () => {
    test("should return null for non-existent signature", () => {
      const record = store.getRecord("non-existent-signature");
      expect(record).toBeNull();
    });

    test("should return full record for existing signature", () => {
      const signature = "test-get-record";
      store.saveSignature({
        signature,
        projectId: "project-get",
        provider: "antigravity",
        endpoint: "daily",
        account: "get@example.com",
      });

      const record = store.getRecord(signature);
      expect(record).not.toBeNull();
      expect(record!.signatureHash).toBe(
        crypto.createHash("sha256").update(signature).digest("hex")
      );
      expect(record!.projectId).toBe("project-get");
      expect(record!.provider).toBe("antigravity");
      expect(record!.endpoint).toBe("daily");
      expect(record!.account).toBe("get@example.com");
      expect(record!.createdAt).toBeGreaterThan(0);
      expect(record!.lastUsedAt).toBeGreaterThan(0);
    });

    test("should update lastUsedAt on each getRecord call", async () => {
      const signature = "test-last-used";
      store.saveSignature({
        signature,
        projectId: "project-1",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const record1 = store.getRecord(signature);
      const lastUsed1 = record1!.lastUsedAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const record2 = store.getRecord(signature);
      const lastUsed2 = record2!.lastUsedAt;

      expect(lastUsed2).toBeGreaterThanOrEqual(lastUsed1);
    });
  });

  describe("isValidForProject", () => {
    test("should return true for matching projectId", () => {
      const signature = "test-valid-project";
      store.saveSignature({
        signature,
        projectId: "project-match",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      expect(store.isValidForProject(signature, "project-match")).toBe(true);
    });

    test("should return false for different projectId", () => {
      const signature = "test-invalid-project";
      store.saveSignature({
        signature,
        projectId: "project-a",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      expect(store.isValidForProject(signature, "project-b")).toBe(false);
    });

    test("should return false for non-existent signature", () => {
      expect(store.isValidForProject("non-existent", "any-project")).toBe(
        false
      );
    });
  });

  describe("TTL expiration", () => {
    test("should return null for expired signatures (7 days)", () => {
      const signature = "test-ttl-expired";
      store.saveSignature({
        signature,
        projectId: "project-ttl",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      // Manually update createdAt to be older than 7 days
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      store["db"]
        .prepare(
          `UPDATE signatures SET createdAt = ? WHERE signatureHash = ?`
        )
        .run(
          eightDaysAgo,
          crypto.createHash("sha256").update(signature).digest("hex")
        );

      const record = store.getRecord(signature);
      expect(record).toBeNull();
    });

    test("should return record for non-expired signatures", () => {
      const signature = "test-ttl-valid";
      store.saveSignature({
        signature,
        projectId: "project-ttl-valid",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      // Set to 6 days ago (within 7-day TTL)
      const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
      store["db"]
        .prepare(
          `UPDATE signatures SET createdAt = ? WHERE signatureHash = ?`
        )
        .run(
          sixDaysAgo,
          crypto.createHash("sha256").update(signature).digest("hex")
        );

      const record = store.getRecord(signature);
      expect(record).not.toBeNull();
    });
  });

  describe("LRU cleanup", () => {
    test("should remove oldest entries when exceeding MAX_ENTRIES (1000)", () => {
      // Create a store with lower limit for testing
      store.close();
      const testStore = new SignatureStore(testDbPath, { maxEntries: 10 });

      // Add 12 entries with explicit lastUsedAt ordering
      const baseTime = Date.now();
      for (let i = 0; i < 12; i++) {
        const hash = crypto
          .createHash("sha256")
          .update(`sig-${i}`)
          .digest("hex");

        // Insert directly with controlled timestamps
        testStore["db"]
          .prepare(
            `INSERT INTO signatures (signatureHash, projectId, provider, endpoint, account, createdAt, lastUsedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            hash,
            `project-${i}`,
            "antigravity",
            "daily",
            `user${i}@example.com`,
            baseTime,
            baseTime + i * 1000 // Older entries have smaller lastUsedAt
          );
      }

      // Trigger cleanup
      testStore["cleanup"]();

      // Count remaining entries
      const countResult = testStore["db"]
        .prepare(`SELECT COUNT(*) as count FROM signatures`)
        .get() as { count: number };
      expect(countResult.count).toBe(10);

      // Check that oldest entries (0, 1) were removed using direct DB query
      const hash0 = crypto.createHash("sha256").update("sig-0").digest("hex");
      const hash1 = crypto.createHash("sha256").update("sig-1").digest("hex");
      const hash11 = crypto.createHash("sha256").update("sig-11").digest("hex");

      const row0 = testStore["db"]
        .prepare(`SELECT 1 FROM signatures WHERE signatureHash = ?`)
        .get(hash0);
      const row1 = testStore["db"]
        .prepare(`SELECT 1 FROM signatures WHERE signatureHash = ?`)
        .get(hash1);
      const row11 = testStore["db"]
        .prepare(`SELECT 1 FROM signatures WHERE signatureHash = ?`)
        .get(hash11);

      expect(row0).toBeNull();
      expect(row1).toBeNull();
      expect(row11).not.toBeNull();

      testStore.close();
    });
  });

  describe("SHA256 hashing", () => {
    test("should handle long signatures correctly", () => {
      const longSignature = "a".repeat(10000);
      store.saveSignature({
        signature: longSignature,
        projectId: "project-long",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      const record = store.getRecord(longSignature);
      expect(record).not.toBeNull();
      expect(record!.signatureHash).toBe(
        crypto.createHash("sha256").update(longSignature).digest("hex")
      );
      expect(record!.signatureHash).toHaveLength(64); // SHA256 hex length
    });

    test("should store hash instead of original signature", () => {
      const signature = "test-hash-storage";
      const expectedHash = crypto
        .createHash("sha256")
        .update(signature)
        .digest("hex");

      store.saveSignature({
        signature,
        projectId: "project-hash",
        provider: "antigravity",
        endpoint: "daily",
        account: "test@example.com",
      });

      // Verify the hash is used as the key
      const row = store["db"]
        .prepare(`SELECT signatureHash FROM signatures WHERE signatureHash = ?`)
        .get(expectedHash) as { signatureHash: string } | undefined;

      expect(row).not.toBeUndefined();
      expect(row!.signatureHash).toBe(expectedHash);
    });
  });

  describe("provider, endpoint, account fields", () => {
    test("should store and retrieve all metadata fields", () => {
      const signature = "test-metadata";
      store.saveSignature({
        signature,
        projectId: "firebase-project-123",
        provider: "antigravity",
        endpoint: "daily",
        account: "service-account@project.iam.gserviceaccount.com",
      });

      const record = store.getRecord(signature);
      expect(record).not.toBeNull();
      expect(record!.provider).toBe("antigravity");
      expect(record!.endpoint).toBe("daily");
      expect(record!.account).toBe(
        "service-account@project.iam.gserviceaccount.com"
      );
    });

    test("should handle different providers", () => {
      store.saveSignature({
        signature: "sig-openai",
        projectId: "project-1",
        provider: "openai",
        endpoint: "prod",
        account: "user@openai.com",
      });

      store.saveSignature({
        signature: "sig-anthropic",
        projectId: "project-2",
        provider: "anthropic",
        endpoint: "staging",
        account: "user@anthropic.com",
      });

      const openaiRecord = store.getRecord("sig-openai");
      const anthropicRecord = store.getRecord("sig-anthropic");

      expect(openaiRecord!.provider).toBe("openai");
      expect(anthropicRecord!.provider).toBe("anthropic");
    });
  });
});
