import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { AuthProviderRegistry, CredentialStorage } from "@llmux/auth";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Codex Responses Handler", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llmux-codex-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    originalFetch = globalThis.fetch;
    AuthProviderRegistry.clear();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
    AuthProviderRegistry.clear();
  });

  describe("openai-web provider routing", () => {
    test("uses openai-web auth provider for openai-web target", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);

      const codexCredential = {
        type: "oauth" as const,
        accessToken: "codex-access-token",
        refreshToken: "codex-refresh-token",
        expiresAt: Date.now() + 3600000,
        accountId: "user_123",
      };
      await CredentialStorage.add("openai-web", codexCredential);

      let capturedHeaders: Record<string, string> = {};
      let capturedUrl = "";

      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers || {})
        );
        // Parse body but don't use it in this test
        JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            id: "resp_123",
            output: [{ type: "message", content: [{ type: "output_text", text: "Hello" }] }],
          }),
          { status: 200 }
        );
      }) as any;

      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Hello" }],
          stream: false,
        }),
      });

      const response = await handleResponses(request, {
        targetProvider: "openai-web",
      });

      expect(response.status).toBe(200);
      expect(capturedUrl).toContain("chatgpt.com/backend-api/codex/responses");
      expect(capturedHeaders["Authorization"]).toBe("Bearer codex-access-token");
      expect(capturedHeaders["chatgpt-account-id"]).toBe("user_123");
      expect(capturedHeaders["OpenAI-Beta"]).toBe("responses=experimental");
      expect(capturedHeaders["originator"]).toBe("codex_cli_rs");
    });

    test("sends store:false for openai-web requests", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);
      await CredentialStorage.add("openai-web", {
        type: "oauth",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
      });

      let capturedBody: any;
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: "resp_123", output: [] }), {
          status: 200,
        });
      }) as any;

      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Test" }],
          stream: false,
        }),
      });

      await handleResponses(request, { targetProvider: "openai-web" });

      expect(capturedBody.store).toBe(false);
      expect(capturedBody.stream).toBe(true); // Codex always streams internally
    });

    test("uses default instructions when not provided", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);
      await CredentialStorage.add("openai-web", {
        type: "oauth",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
      });

      let capturedInstructions: string | undefined;
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        capturedInstructions = body.instructions;
        return new Response(JSON.stringify({ id: "resp_123", output: [] }), {
          status: 200,
        });
      }) as any;

      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Test" }],
        }),
      });

      await handleResponses(request, { targetProvider: "openai-web" });

      expect(capturedInstructions).toBeDefined();
      expect(typeof capturedInstructions).toBe("string");
      expect(capturedInstructions?.length).toBeGreaterThan(0);
    });

    test("uses provided instructions when specified", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);
      await CredentialStorage.add("openai-web", {
        type: "oauth",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
      });

      let capturedBody: any;
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: "resp_123", output: [] }), {
          status: 200,
        });
      }) as any;

      const customInstructions = "You are a helpful assistant.";
      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Test" }],
          instructions: customInstructions,
        }),
      });

      await handleResponses(request, { targetProvider: "openai-web" });

      expect(capturedBody.instructions).toBe(customInstructions);
    });

    test("returns 401 when no openai-web credentials found", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);
      // No credentials added

      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Test" }],
        }),
      });

      const response = await handleResponses(request, {
        targetProvider: "openai-web",
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect((body.error as string | undefined)?.includes("openai-web")).toBe(
        true
      );
    });

    test("passes through tools and reasoning fields", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);
      await CredentialStorage.add("openai-web", {
        type: "oauth",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
      });

      let capturedBody: Record<string, unknown> | undefined;
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: "resp_123", output: [] }), {
          status: 200,
        });
      }) as unknown as typeof globalThis.fetch;

      const tools = [{ type: "function", function: { name: "test_tool" } }];
      const reasoning = { effort: "medium" };

      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Test" }],
          tools,
          reasoning,
        }),
      });

      await handleResponses(request, { targetProvider: "openai-web" });

      // Tools are transformed by handleResponses (nested function -> flattened)
      expect(capturedBody?.tools).toEqual([{ type: "function", name: "test_tool" }]);
      expect(capturedBody?.reasoning).toEqual(reasoning);
    });
  });

  describe("does not alias openai-web to openai", () => {
    test("openai-web uses openai-web credentials not openai credentials", async () => {
      const { OpenAIWebProvider } = await import("@llmux/auth");
      const { handleResponses } = await import("../../src/handlers/responses");

      AuthProviderRegistry.register(OpenAIWebProvider);

      // Add openai credentials (should NOT be used)
      await CredentialStorage.add("openai", {
        type: "api",
        key: "sk-openai-key",
      });

      // No openai-web credentials
      const request = new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-codex",
          input: [{ type: "message", role: "user", content: "Test" }],
        }),
      });

      const response = await handleResponses(request, {
        targetProvider: "openai-web",
      });

      // Should fail because openai-web credentials are not found
      // even though openai credentials exist
      expect(response.status).toBe(401);
    });
  });
});
