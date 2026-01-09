import { describe, expect, it } from "bun:test";
import { ANTIGRAVITY_HEADERS, GEMINI_CLI_HEADERS } from "../../src/providers/antigravity-constants";

describe("Antigravity Headers Fix (TDD)", () => {
  it("should have Client-Metadata as JSON for ANTIGRAVITY_HEADERS", () => {
    const clientMetadata = ANTIGRAVITY_HEADERS["Client-Metadata"];
    
    // ANTIGRAVITY_HEADERS uses JSON format
    expect(() => JSON.parse(clientMetadata)).not.toThrow();
    
    const parsed = JSON.parse(clientMetadata);
    expect(parsed.ideType).toBe("IDE_UNSPECIFIED");
    expect(parsed.platform).toBe("PLATFORM_UNSPECIFIED");
    expect(parsed.pluginType).toBe("GEMINI");
  });

  it("should have Client-Metadata in key=value format for GEMINI_CLI_HEADERS", () => {
    const clientMetadata = GEMINI_CLI_HEADERS["Client-Metadata"];
    
    // GEMINI_CLI_HEADERS uses key=value format, NOT JSON
    expect(() => JSON.parse(clientMetadata)).toThrow();
    
    // It should be in key=value format
    expect(clientMetadata).toContain("ideType=");
    expect(clientMetadata).toContain("platform=");
    expect(clientMetadata).toContain("pluginType=");
    expect(clientMetadata).not.toContain("{");
    expect(clientMetadata).not.toContain("}");
  });
});
