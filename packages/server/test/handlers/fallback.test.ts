import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  FallbackHandler,
  extractModel,
  type ProviderChecker,
} from "../../src/handlers/fallback";
import { createInMemoryServer } from "../../src/utils/in-memory-server";
import {
  createUpstreamProxy,
  type UpstreamProxy,
} from "../../src/upstream/proxy";
import { rateLimitStore } from "../../src/handlers/rate-limit-store";
import { TokenRefresh, CredentialStorage } from "@llmux/auth";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("FallbackHandler", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    rateLimitStore.clear();
    TokenRefresh.clearPending();

    tempDir = await mkdtemp(join(tmpdir(), "llmux-fallback-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Add dummy credentials to prevent TokenRefresh from throwing
    await CredentialStorage.add("antigravity", {
      type: "oauth",
      accessToken: "test-token",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600000,
    });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    test("should create fallback handler with proxy getter", () => {
      const mockProxy: UpstreamProxy = {
        proxyRequest: async () => new Response("ok"),
        targetUrl: "http://test",
      };
      const fallback = new FallbackHandler(() => mockProxy);
      expect(fallback).toBeDefined();
    });

    test("should create fallback handler without proxy", () => {
      const fallback = new FallbackHandler(() => null);
      expect(fallback).toBeDefined();
    });

    test("should create fallback handler with provider checker", () => {
      const mockProxy: UpstreamProxy = {
        proxyRequest: async () => new Response("ok"),
        targetUrl: "http://test",
      };
      const providerChecker: ProviderChecker = () => true;
      const fallback = new FallbackHandler(() => mockProxy, providerChecker);
      expect(fallback).toBeDefined();
    });
  });
});

describe("extractModel", () => {
  describe("from JSON body", () => {
    test("should extract model from JSON body", async () => {
      const body = JSON.stringify({ model: "gpt-4o", messages: [] });
      const request = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const model = await extractModel(request);
      expect(model).toBe("gpt-4o");
    });

    test("should return null for missing model field", async () => {
      const body = JSON.stringify({ messages: [] });
      const request = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const model = await extractModel(request);
      expect(model).toBeNull();
    });

    test("should return null for invalid JSON", async () => {
      const request = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });
      const model = await extractModel(request);
      expect(model).toBeNull();
    });

    test("should return null for empty body", async () => {
      const request = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const model = await extractModel(request);
      expect(model).toBeNull();
    });
  });

  describe("from URL path (Gemini style)", () => {
    test("should extract model from URL path with action suffix", async () => {
      const request = new Request(
        "http://localhost/v1beta/models/gemini-pro:generateContent",
        { method: "POST" }
      );
      const model = await extractModel(request, {
        action: "gemini-pro:generateContent",
      });
      expect(model).toBe("gemini-pro");
    });

    test("should extract model from URL path with streamGenerateContent", async () => {
      const request = new Request(
        "http://localhost/v1beta/models/gemini-2.0-flash:streamGenerateContent",
        { method: "POST" }
      );
      const model = await extractModel(request, {
        action: "gemini-2.0-flash:streamGenerateContent",
      });
      expect(model).toBe("gemini-2.0-flash");
    });

    test("should extract model from publishers path (Amp format)", async () => {
      const request = new Request(
        "http://localhost/publishers/google/models/gemini-3-pro:streamGenerateContent",
        { method: "POST" }
      );
      const model = await extractModel(request, {
        path: "models/gemini-3-pro:streamGenerateContent",
      });
      expect(model).toBe("gemini-3-pro");
    });
  });
});

describe("FallbackHandler.wrap", () => {
  let mockUpstreamServer: { port: number; stop: () => void };
  let mockUpstreamUrl: string;
  const upstreamRequests: Array<{ path: string; body: unknown }> = [];

  beforeAll(() => {
    mockUpstreamServer = createInMemoryServer(async (req) => {
        const url = new URL(req.url);
        let body: unknown = null;
        if (req.method === "POST") {
          try {
            body = await req.json();
          } catch {
            body = await req.text();
          }
        }
        upstreamRequests.push({ path: url.pathname, body });
        const bodyModel =
          body && typeof body === "object" && "model" in body
            ? (body as { model: string }).model
            : undefined;
        return new Response(
          JSON.stringify({ source: "upstream", model: bodyModel }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
    });
    mockUpstreamUrl = `http://localhost:${mockUpstreamServer.port}`;
  });

  afterAll(() => {
    mockUpstreamServer.stop();
  });

  beforeEach(() => {
    upstreamRequests.length = 0;
  });

  test("should use local handler when provider available", async () => {
    let localHandlerCalled = false;
    const localHandler = async (_req: Request) => {
      localHandlerCalled = true;
      return new Response(JSON.stringify({ source: "local" }), {
        headers: { "Content-Type": "application/json" },
      });
    };

    const mockProxy = createUpstreamProxy({ targetUrl: mockUpstreamUrl });
    const providerChecker: ProviderChecker = (model) => model === "gpt-4o";
    const fallback = new FallbackHandler(() => mockProxy, providerChecker);

    const wrappedHandler = fallback.wrap(localHandler);
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    });

    const response = await wrappedHandler(request, {});
    const data = (await response.json()) as { source: string };

    expect(localHandlerCalled).toBe(true);
    expect(data.source).toBe("local");
    expect(upstreamRequests.length).toBe(0);
  });

  test("should proxy to upstream when no local provider", async () => {
    let localHandlerCalled = false;
    const localHandler = async () => {
      localHandlerCalled = true;
      return new Response("local");
    };

    const mockProxy = createUpstreamProxy({ targetUrl: mockUpstreamUrl });
    const providerChecker: ProviderChecker = () => false; // No providers available
    const fallback = new FallbackHandler(() => mockProxy, providerChecker);

    const wrappedHandler = fallback.wrap(localHandler);
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
    });

    const response = await wrappedHandler(request, {});
    const data = (await response.json()) as { source: string };

    expect(localHandlerCalled).toBe(false);
    expect(data.source).toBe("upstream");
    expect(upstreamRequests.length).toBe(1);
  });

  test("should return error when no provider and no proxy", async () => {
    const localHandler = async () => new Response("local");
    const providerChecker: ProviderChecker = () => false;
    const fallback = new FallbackHandler(() => null, providerChecker);

    const wrappedHandler = fallback.wrap(localHandler);
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "unknown-model", messages: [] }),
    });

    const response = await wrappedHandler(request, {});

    expect(response.status).toBe(503);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBeDefined();
  });

  test("should pass through when model cannot be extracted", async () => {
    let localHandlerCalled = false;
    const localHandler = async () => {
      localHandlerCalled = true;
      return new Response("local");
    };

    const mockProxy = createUpstreamProxy({ targetUrl: mockUpstreamUrl });
    const providerChecker: ProviderChecker = () => false;
    const fallback = new FallbackHandler(() => mockProxy, providerChecker);

    const wrappedHandler = fallback.wrap(localHandler);
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }), // No model field
    });

    const response = await wrappedHandler(request, {});

    expect(localHandlerCalled).toBe(true);
    expect(await response.text()).toBe("local");
  });

  test("should preserve request body for local handler", async () => {
    let receivedBody: unknown = null;
    const localHandler = async (req: Request) => {
      receivedBody = await req.json();
      return new Response("ok");
    };

    const providerChecker: ProviderChecker = () => true;
    const fallback = new FallbackHandler(() => null, providerChecker);

    const wrappedHandler = fallback.wrap(localHandler);
    const originalBody = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    };
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(originalBody),
    });

    await wrappedHandler(request, {});

    expect(receivedBody).toEqual(originalBody);
  });

  test("should pass params to wrapped handler", async () => {
    let receivedParams: Record<string, string> | undefined;
    const localHandler = async (
      _req: Request,
      params?: Record<string, string>
    ) => {
      receivedParams = params;
      return new Response("ok");
    };

    const providerChecker: ProviderChecker = () => true;
    const fallback = new FallbackHandler(() => null, providerChecker);

    const wrappedHandler = fallback.wrap(localHandler);
    const request = new Request(
      "http://localhost/api/provider/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o" }),
      }
    );

    await wrappedHandler(request, { provider: "openai" });

    expect(receivedParams).toEqual({ provider: "openai" });
  });

  test("should call router.resolveModel when router is provided", async () => {
    let resolveModelCalled = false;
    const mockRouter = {
      resolveModel: async (model: string) => {
        resolveModelCalled = true;
        return { provider: "openai", model };
      },
      handleRateLimit: () => {},
      handleSuccess: () => {},
    };

    const providerChecker: ProviderChecker = () => false;
    const fallback = new FallbackHandler(
      () => null,
      providerChecker,
      undefined,
      mockRouter as never
    );

    const wrappedHandler = fallback.wrap(async () => new Response("ok"));
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [], stream: false }),
    });

    await wrappedHandler(request, {});

    expect(resolveModelCalled).toBe(true);
  });
});
