import { describe, expect, it } from "bun:test";
import { resolveGeminiFamilyCapabilities } from "../../../src/formats/gemini/capabilities.js";

describe("GeminiCapabilities", () => {
  it("should resolve capabilities for Claude models on Antigravity", () => {
    const caps = resolveGeminiFamilyCapabilities("claude-3-5-sonnet");
    expect(caps.modelVendor).toBe("anthropic");
    expect(caps.thinkingWireStyle).toBe("snake");
    expect(caps.requiresStrictToolPairing).toBe(true);
  });

  it("should resolve capabilities for Gemini 3 models", () => {
    const caps = resolveGeminiFamilyCapabilities("gemini-3-pro-preview");
    expect(caps.modelVendor).toBe("google");
    expect(caps.thinkingParamStyle).toBe("level");
  });

  it("should resolve capabilities for Gemini 2.5 models", () => {
    const caps = resolveGeminiFamilyCapabilities("gemini-2.5-flash");
    expect(caps.modelVendor).toBe("google");
    expect(caps.thinkingParamStyle).toBe("budget");
  });

  it("should default to standard gemini for unknown models", () => {
    const caps = resolveGeminiFamilyCapabilities("unknown-model");
    expect(caps.modelVendor).toBe("google");
    expect(caps.requiresStrictToolPairing).toBe(false);
  });
});
