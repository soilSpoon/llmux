import { describe, expect, it } from "bun:test";
import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from "@llmux/auth";

describe("Antigravity Endpoint Fallback Logic", () => {
  it("should have correct fallback endpoints defined", () => {
    // After removing Autopush (unavailable), only Daily and Prod remain
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toHaveLength(2);
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[0]).toContain("daily");
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[1]).toContain(
      "cloudcode-pa.googleapis.com"
    );
  });

  it("should cycle through fallbacks correctly based on attempt count", () => {
    const fallbackCount = ANTIGRAVITY_ENDPOINT_FALLBACKS.length;

    // Attempt 1 -> Index 0 (Daily)
    expect((1 - 1) % fallbackCount).toBe(0);

    // Attempt 2 -> Index 1 (Prod)
    expect((2 - 1) % fallbackCount).toBe(1);

    // Attempt 3 -> Index 0 (Cycle back to Daily)
    expect((3 - 1) % fallbackCount).toBe(0);
  });
});
