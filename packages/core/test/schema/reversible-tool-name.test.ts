/**
 * Reversible Tool Name Encoding/Decoding Tests
 * TDD Cycle 1: Red - These tests should FAIL initially as implementation doesn't exist yet.
 */

import { describe, expect, it } from "bun:test";
import {
  encodeAntigravityToolName,
  decodeAntigravityToolName,
} from "../../src/schema/reversible-tool-name";

describe("Reversible Tool Name Encoding", () => {
  describe("encodeAntigravityToolName", () => {
    it("should encode slash to __slash__", () => {
      expect(encodeAntigravityToolName("mcp/read_file")).toBe(
        "mcp__slash__read_file"
      );
    });

    it("should encode multiple slashes", () => {
      expect(encodeAntigravityToolName("a/b/c")).toBe("a__slash__b__slash__c");
    });

    it("should encode space to __space__", () => {
      expect(encodeAntigravityToolName("my tool")).toBe("my__space__tool");
    });

    it("should leave valid characters unchanged", () => {
      expect(encodeAntigravityToolName("get_weather")).toBe("get_weather");
      expect(encodeAntigravityToolName("mcp:mongodb.query")).toBe(
        "mcp:mongodb.query"
      );
      expect(encodeAntigravityToolName("read-file")).toBe("read-file");
    });

    it("should handle already encoded names (idempotency)", () => {
      const encoded = encodeAntigravityToolName("mcp/read_file");
      expect(encodeAntigravityToolName(encoded)).toBe("mcp__slash__read_file");
    });

    it("should handle empty string", () => {
      expect(encodeAntigravityToolName("")).toBe("_tool");
    });

    it("should prefix with underscore if starts with invalid character", () => {
      expect(encodeAntigravityToolName("123_tool")).toBe("_123_tool");
    });
  });

  describe("decodeAntigravityToolName", () => {
    it("should decode __slash__ to slash", () => {
      expect(decodeAntigravityToolName("mcp__slash__read_file")).toBe(
        "mcp/read_file"
      );
    });

    it("should decode multiple __slash__", () => {
      expect(decodeAntigravityToolName("a__slash__b__slash__c")).toBe("a/b/c");
    });

    it("should decode __space__ to space", () => {
      expect(decodeAntigravityToolName("my__space__tool")).toBe("my tool");
    });

    it("should leave already decoded names unchanged", () => {
      expect(decodeAntigravityToolName("get_weather")).toBe("get_weather");
      expect(decodeAntigravityToolName("mcp:mongodb.query")).toBe(
        "mcp:mongodb.query"
      );
    });

    it("should handle empty string", () => {
      expect(decodeAntigravityToolName("")).toBe("");
    });
  });

  describe("Round-trip encoding/decoding", () => {
    it("should perfectly restore original name after round-trip", () => {
      const originalNames = [
        "mcp/read_file",
        "mcp/write_file",
        "my tool with spaces",
        "path/to/nested/tool",
        "get_weather",
        "mcp:mongodb.query",
        "read-file",
      ];

      for (const name of originalNames) {
        const encoded = encodeAntigravityToolName(name);
        const decoded = decodeAntigravityToolName(encoded);
        expect(decoded).toBe(name);
      }
    });
  });
});
