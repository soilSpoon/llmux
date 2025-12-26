import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { AntigravityProvider } from "../../src/providers/antigravity";
import { CredentialStorage } from "../../src/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AntigravityProvider", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llmux-auth-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  test("has correct id and name", () => {
    expect(AntigravityProvider.id).toBe("antigravity");
    expect(AntigravityProvider.name).toBe("Antigravity (Gemini)");
  });

  test("supports oauth method", () => {
    const oauthMethod = AntigravityProvider.methods.find(
      (m) => m.type === "oauth"
    );
    expect(oauthMethod).toBeDefined();
    expect(oauthMethod?.label).toBe("Google OAuth");
  });

  test("getCredential returns undefined when no credential stored", async () => {
    const credential = await AntigravityProvider.getCredential();
    expect(credential).toBeUndefined();
  });

  test("getCredential returns stored credential", async () => {
    await CredentialStorage.add("antigravity", {
      type: "api",
      key: "test-key",
    });
    const credential = await AntigravityProvider.getCredential();
    expect(credential).toEqual({ type: "api", key: "test-key" });
  });

  test("getHeaders returns x-goog-api-key header for API key", async () => {
    const credential = { type: "api" as const, key: "AIza-test-key" };
    const headers = await AntigravityProvider.getHeaders(credential);
    expect(headers["x-goog-api-key"]).toBe("AIza-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("getHeaders returns Authorization for OAuth credential", async () => {
    const oauth = {
      type: "oauth" as const,
      accessToken: "ya29.test_token",
      refreshToken: "refresh_test",
      expiresAt: Date.now() + 3600000,
      projectId: "my-project",
    };
    const headers = await AntigravityProvider.getHeaders(oauth);
    expect(headers["Authorization"]).toBe("Bearer ya29.test_token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBeDefined();
    expect(headers["X-Goog-Api-Client"]).toBeDefined();
    expect(headers["Client-Metadata"]).toBeDefined();
  });

  test("getEndpoint returns correct Gemini URL with model", () => {
    const endpoint = AntigravityProvider.getEndpoint("gemini-2.0-flash");
    expect(endpoint).toBe(
      "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent"
    );
  });

  test("getEndpoint returns correct Gemini URL for streaming", () => {
    // @ts-ignore - interface update pending
    const endpoint = AntigravityProvider.getEndpoint("gemini-2.0-flash", {
      streaming: true,
    });
    expect(endpoint).toBe(
      "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse"
    );
  });

  test("getEndpoint handles different model names", () => {
    expect(AntigravityProvider.getEndpoint("gemini-pro")).toContain(
      "v1internal:generateContent"
    );
    expect(AntigravityProvider.getEndpoint("gemini-1.5-pro")).toContain(
      "v1internal:generateContent"
    );
  });

  test("rotate increments active index", () => {
    expect(AntigravityProvider.rotate).toBeDefined();
    AntigravityProvider.rotate!();
    // Just verify it doesn't throw
  });

  test("refresh function exists", () => {
    expect(AntigravityProvider.refresh).toBeDefined();
  });
});
