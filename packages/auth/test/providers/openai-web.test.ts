import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { OpenAIWebProvider } from "../../src/providers/openai-web";
import { CredentialStorage } from "../../src/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const startOpenAIOAuthListenerMock = mock(async () => ({
  waitForCallback: async () =>
    new URL("http://localhost:1455/auth/callback?code=valid_code"),
  close: async () => {},
}));

mock.module("../../src/providers/openai-server", () => ({
  startOpenAIOAuthListener: startOpenAIOAuthListenerMock,
}));

describe("OpenAIWebProvider", () => {
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
    expect(OpenAIWebProvider.id).toBe("openai-web");
    expect(OpenAIWebProvider.name).toBe("OpenAI (Web)");
  });

  test("supports oauth method", () => {
    const oauthMethod = OpenAIWebProvider.methods.find(
      (m) => m.type === "oauth"
    );
    expect(oauthMethod).toBeDefined();
    expect(oauthMethod?.label).toBe("ChatGPT Plus/Pro (Web Login)");
  });

  test("getHeaders returns correct headers for oauth credential", async () => {
    const credential = {
      type: "oauth" as const,
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: Date.now() + 3600000,
    };
    const headers = await OpenAIWebProvider.getHeaders(credential);

    // ChatGPT backend-api requires Authorization and chatgpt-account-id (if available)
    expect(headers["Authorization"]).toBe("Bearer test-access-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("getEndpoint returns correct backend-api URL", () => {
    const endpoint = OpenAIWebProvider.getEndpoint("gpt-4o");
    // opencode uses https://chatgpt.com/backend-api/codex (or similar)
    // We expect the base to be https://chatgpt.com/backend-api
    expect(endpoint).toContain("chatgpt.com/backend-api");
  });

  test("authorize returns intermediate step with login URL", async () => {
    const oauthMethod = OpenAIWebProvider.methods.find(
      (m) => m.type === "oauth"
    )!;
    const result = await oauthMethod.authorize();

    expect(result.type).toBe("intermediate");
    if (result.type === "intermediate") {
      expect(result.url).toContain("auth.openai.com/oauth/authorize");
      expect(result.url).toContain("client_id=");
      expect(result.url).toContain("code_challenge=");
      expect(result.url).toContain("response_type=code");
      expect(typeof result.callback).toBe("function");
    }
  });

  test("callback exchanges code for tokens and stores them", async () => {
    const oauthMethod = OpenAIWebProvider.methods.find(
      (m) => m.type === "oauth"
    )!;
    const intermediate = (await oauthMethod.authorize()) as any;

    const mockTokenResponse = {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expires_in: 3600,
    };

    const originalFetch = global.fetch;
    global.fetch = mock(async () => {
      return new Response(JSON.stringify(mockTokenResponse), { status: 200 });
    }) as any;

    try {
      const authResult = await intermediate.callback();
      expect(authResult.type).toBe("success");
      if (authResult.type === "success") {
        expect(authResult.credential.type).toBe("oauth");
        expect(authResult.credential.accessToken).toBe("mock-access-token");
        expect(authResult.credential.refreshToken).toBe("mock-refresh-token");
      }

      const stored = await CredentialStorage.get("openai-web");
      expect(stored[0]).toMatchObject({
        type: "oauth",
        accessToken: "mock-access-token",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("refresh method obtains new tokens using refresh token", async () => {
    const currentCredential = {
      type: "oauth" as const,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1000, // Expired
    };

    const mockRefreshResponse = {
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    };

    const originalFetch = global.fetch;
    global.fetch = mock(async () => {
      return new Response(JSON.stringify(mockRefreshResponse), { status: 200 });
    }) as any;

    try {
      if (!OpenAIWebProvider.refresh) {
        throw new Error("Refresh method not implemented");
      }
      const newCredential = await OpenAIWebProvider.refresh(currentCredential);

      expect(newCredential.type).toBe("oauth");
      if (newCredential.type === "oauth") {
        expect(newCredential.accessToken).toBe("new-access");
        expect(newCredential.refreshToken).toBe("new-refresh");
        expect(newCredential.expiresAt).toBeGreaterThan(Date.now());
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("callback returns failed when listener fails", async () => {
    startOpenAIOAuthListenerMock.mockImplementationOnce(async () => ({
      waitForCallback: async () => {
        throw new Error("Listener timeout");
      },
      close: async () => {},
    }));

    const oauthMethod = OpenAIWebProvider.methods.find(
      (m) => m.type === "oauth"
    )!;
    const intermediate = (await oauthMethod.authorize()) as any;

    const authResult = await intermediate.callback();
    expect(authResult.type).toBe("failed");
    expect(authResult.error).toBe("Listener timeout");
  });

  test("callback returns failed on token exchange error", async () => {
    const oauthMethod = OpenAIWebProvider.methods.find(
      (m) => m.type === "oauth"
    )!;
    const intermediate = (await oauthMethod.authorize()) as any;

    const originalFetch = global.fetch;
    global.fetch = mock(async () => {
      return new Response("Invalid code", { status: 400 });
    }) as any;

    try {
      const authResult = await intermediate.callback("code=invalid");
      expect(authResult.type).toBe("failed");
      expect(authResult.error).toContain("Token exchange failed");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
