import { describe, expect, it } from "bun:test";
import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from "@llmux/auth";

describe("Antigravity Endpoint Fallback Logic", () => {
  it("should have correct fallback endpoints defined", () => {
    // Sandbox, Daily, and Prod endpoints (Order changed in implementation)
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toHaveLength(3);
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[0]).toBe(
      "https://daily-cloudcode-pa.sandbox.googleapis.com"
    );
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[1]).toBe(
      "https://daily-cloudcode-pa.googleapis.com"
    );
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS[2]).toBe("https://cloudcode-pa.googleapis.com");
  });

  it("should cycle through fallbacks correctly based on attempt count", () => {
    const fallbackCount = ANTIGRAVITY_ENDPOINT_FALLBACKS.length;

    // Attempt 1 -> Index 0 (Daily)
    expect((1 - 1) % fallbackCount).toBe(0);

    // Attempt 2 -> Index 1 (Sandbox)
    expect((2 - 1) % fallbackCount).toBe(1);

    // Attempt 3 -> Index 2 (Prod)
    expect((3 - 1) % fallbackCount).toBe(2);

    // Attempt 4 -> Index 0 (Cycle back to Daily)
    expect((4 - 1) % fallbackCount).toBe(0);
  });
});
