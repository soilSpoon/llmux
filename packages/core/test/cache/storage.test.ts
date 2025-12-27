import { describe, it, expect, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = "/tmp/test-signatures.db";

describe("SQLiteStorage", () => {
  afterEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
      } catch {}
    }
  });

  describe("Constructor", () => {
    it("should create a new SQLite storage instance", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);
      expect(storage).toBeInstanceOf(SQLiteStorage);
      storage.close();
    });
  });

  describe("get/set", () => {
    it("should store and retrieve an entry", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      storage.set("session-1", "model:hash", entry);
      const retrieved = storage.get("session-1", "model:hash");

      expect(retrieved).toEqual(entry);
      storage.close();
    });

    it("should return undefined for non-existent entry", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const retrieved = storage.get("session-1", "model:hash");
      expect(retrieved).toBeUndefined();
      storage.close();
    });

    it("should overwrite existing entry", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry1 = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };
      const entry2 = {
        signature: "b".repeat(50),
        family: "claude" as const,
        timestamp: Date.now() + 1000,
        sessionId: "session-1",
      };

      storage.set("session-1", "model:hash", entry1);
      storage.set("session-1", "model:hash", entry2);

      const retrieved = storage.get("session-1", "model:hash");
      expect(retrieved?.signature).toBe("b".repeat(50));
      storage.close();
    });
  });

  describe("delete", () => {
    it("should delete an entry", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      storage.set("session-1", "model:hash", entry);
      storage.delete("session-1", "model:hash");

      const retrieved = storage.get("session-1", "model:hash");
      expect(retrieved).toBeUndefined();
      storage.close();
    });
  });

  describe("clearSession", () => {
    it("should clear all entries for a session", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry1 = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };
      const entry2 = {
        signature: "b".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      storage.set("session-1", "model:hash1", entry1);
      storage.set("session-1", "model:hash2", entry2);
      storage.clearSession("session-1");

      expect(storage.get("session-1", "model:hash1")).toBeUndefined();
      expect(storage.get("session-1", "model:hash2")).toBeUndefined();
      storage.close();
    });

    it("should not affect other sessions", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry1 = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };
      const entry2 = {
        signature: "b".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-2",
      };

      storage.set("session-1", "model:hash", entry1);
      storage.set("session-2", "model:hash", entry2);
      storage.clearSession("session-1");

      expect(storage.get("session-1", "model:hash")).toBeUndefined();
      expect(storage.get("session-2", "model:hash")).toBeDefined();
      storage.close();
    });
  });

  describe("getSessionEntries", () => {
    it("should return all entries for a session", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry1 = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };
      const entry2 = {
        signature: "b".repeat(50),
        family: "gemini" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      storage.set("session-1", "model:hash1", entry1);
      storage.set("session-1", "model:hash2", entry2);

      const entries = storage.getSessionEntries("session-1");
      expect(entries.size).toBe(2);
      expect(entries.get("model:hash1")?.family).toBe("claude");
      expect(entries.get("model:hash2")?.family).toBe("gemini");
      storage.close();
    });
  });

  describe("getSessionEntryCount", () => {
    it("should return the count of entries for a session", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const entry = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      expect(storage.getSessionEntryCount("session-1")).toBe(0);
      storage.set("session-1", "model:hash1", entry);
      expect(storage.getSessionEntryCount("session-1")).toBe(1);
      storage.set("session-1", "model:hash2", entry);
      expect(storage.getSessionEntryCount("session-1")).toBe(2);
      storage.close();
    });
  });

  describe("cleanupExpired", () => {
    it("should remove expired entries", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");
      const storage = new SQLiteStorage(TEST_DB_PATH);

      const oldEntry = {
        signature: "a".repeat(50),
        family: "claude" as const,
        timestamp: Date.now() - 10000,
        sessionId: "session-1",
      };
      const newEntry = {
        signature: "b".repeat(50),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      storage.set("session-1", "model:old", oldEntry);
      storage.set("session-1", "model:new", newEntry);

      const deleted = storage.cleanupExpired(5000);
      expect(deleted).toBe(1);
      expect(storage.get("session-1", "model:old")).toBeUndefined();
      expect(storage.get("session-1", "model:new")).toBeDefined();
      storage.close();
    });
  });

  describe("Persistence", () => {
    it("should persist data across instances", async () => {
      const { SQLiteStorage } = await import("../../src/cache/storage");

      const entry = {
        signature: "persistent".repeat(10),
        family: "claude" as const,
        timestamp: Date.now(),
        sessionId: "session-1",
      };

      const storage1 = new SQLiteStorage(TEST_DB_PATH);
      storage1.set("session-1", "model:hash", entry);
      storage1.close();

      const storage2 = new SQLiteStorage(TEST_DB_PATH);
      const retrieved = storage2.get("session-1", "model:hash");
      expect(retrieved?.signature).toBe("persistent".repeat(10));
      storage2.close();
    });
  });
});

describe("SignatureCache with SQLiteStorage", () => {
  afterEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
      } catch {}
    }
  });

  it("should work with SQLiteStorage", async () => {
    const { SignatureCache, SQLiteStorage } = await import(
      "../../src/cache/signature"
    );
    const storage = new SQLiteStorage(TEST_DB_PATH);
    const cache = new SignatureCache({ storage });

    const key = {
      sessionId: "session-1",
      model: "claude-3",
      textHash: "hash-1",
    };
    const signature = "a".repeat(50);

    cache.store(key, signature, "claude");
    const restored = cache.restore(key);

    expect(restored).toBe(signature);
    storage.close();
  });

  it("should persist across cache instances", async () => {
    const { SignatureCache, SQLiteStorage } = await import(
      "../../src/cache/signature"
    );

    const key = {
      sessionId: "session-1",
      model: "claude-3",
      textHash: "hash-1",
    };
    const signature = "persistent".repeat(10);

    const storage1 = new SQLiteStorage(TEST_DB_PATH);
    const cache1 = new SignatureCache({ storage: storage1 });
    cache1.store(key, signature, "claude");
    storage1.close();

    const storage2 = new SQLiteStorage(TEST_DB_PATH);
    const cache2 = new SignatureCache({ storage: storage2 });
    const restored = cache2.restore(key);
    expect(restored).toBe(signature);
    storage2.close();
  });
});
