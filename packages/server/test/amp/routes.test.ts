import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createAmpRoutes, type ProviderHandlers } from "../../src/amp/routes";
import {
  FallbackHandler,
  type ProviderChecker,
} from "../../src/handlers/fallback";
import { createUpstreamProxy } from "../../src/upstream/proxy";
import { createRouter } from "../../src/router";
import {
  startServer,
  type LlmuxServer,
  type AmpConfig,
} from "../../src/server";

describe("createAmpRoutes", () => {
  test("should create amp provider routes", () => {
    const mockHandler = async () => new Response("ok");
    const handlers: ProviderHandlers = {
      openai: mockHandler,
      anthropic: mockHandler,
      google: mockHandler,
    };

    const routes = createAmpRoutes({ handlers });

    expect(routes).toContainEqual(
      expect.objectContaining({
        path: "/api/provider/:provider/v1/chat/completions",
      })
    );
    expect(routes).toContainEqual(
      expect.objectContaining({ path: "/api/provider/:provider/v1/messages" })
    );
  });

  test("should include models endpoint", () => {
    const mockHandler = async () => new Response("ok");
    const handlers: ProviderHandlers = {
      openai: mockHandler,
    };

    const routes = createAmpRoutes({ handlers });

    expect(routes).toContainEqual(
      expect.objectContaining({
        path: "/api/provider/:provider/v1/models",
        method: "GET",
      })
    );
  });

  test("should include gemini routes with wildcard", () => {
    const mockHandler = async () => new Response("ok");
    const handlers: ProviderHandlers = {
      google: mockHandler,
    };

    const routes = createAmpRoutes({ handlers });

    expect(routes).toContainEqual(
      expect.objectContaining({ path: "/v1beta/models/*action" })
    );
  });
});

describe("Provider routing", () => {
  const createMockHandlers = (): ProviderHandlers => ({
    openai: async () =>
      new Response(JSON.stringify({ source: "openai" }), {
        headers: { "Content-Type": "application/json" },
      }),
    anthropic: async () =>
      new Response(JSON.stringify({ source: "anthropic" }), {
        headers: { "Content-Type": "application/json" },
      }),
    google: async () =>
      new Response(JSON.stringify({ source: "google" }), {
        headers: { "Content-Type": "application/json" },
      }),
  });

  test("should route to OpenAI handler for openai provider", async () => {
    const handlers = createMockHandlers();
    const routes = createAmpRoutes({ handlers });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      }
    );

    const response = await router(request);
    const data: any = await response.json();

    expect(data.source).toBe("openai");
  });

  test("should route to Anthropic handler for anthropic provider", async () => {
    const handlers = createMockHandlers();
    const routes = createAmpRoutes({ handlers });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/anthropic/v1/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          messages: [],
        }),
      }
    );

    const response = await router(request);
    const data: any = await response.json();

    expect(data.source).toBe("anthropic");
  });

  test("should route to Google handler for google provider", async () => {
    const handlers = createMockHandlers();
    const routes = createAmpRoutes({ handlers });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/google/v1beta/models/gemini-pro:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [] }),
      }
    );

    const response = await router(request);
    const data: any = await response.json();

    expect(data.source).toBe("google");
  });

  test("should return 404 for unknown provider", async () => {
    const handlers = createMockHandlers();
    const routes = createAmpRoutes({ handlers });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/unknown/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: [] }),
      }
    );

    const response = await router(request);
    expect(response.status).toBe(404);
  });

  test("should pass provider param to handler", async () => {
    let receivedProvider: string | undefined;

    const handlers: ProviderHandlers = {
      openai: async (_req, params) => {
        receivedProvider = params?.provider;
        return new Response("ok");
      },
    };

    const routes = createAmpRoutes({ handlers });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      }
    );

    await router(request);
    expect(receivedProvider).toBe("openai");
  });
});

describe("Models endpoint", () => {
  test("should return provider-specific models list", async () => {
    const modelsHandler = async (
      _req: Request,
      params?: Record<string, string>
    ) => {
      const provider = params?.provider;
      const models =
        provider === "openai"
          ? ["gpt-4o", "gpt-4o-mini"]
          : provider === "anthropic"
          ? ["claude-sonnet-4-20250514", "claude-3-haiku"]
          : [];

      return new Response(JSON.stringify({ models }), {
        headers: { "Content-Type": "application/json" },
      });
    };

    const handlers: ProviderHandlers = {
      openai: async () => new Response("ok"),
    };

    const routes = createAmpRoutes({ handlers, modelsHandler });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/openai/v1/models",
      {
        method: "GET",
      }
    );

    const response = await router(request);
    const data: any = await response.json();

    expect(data.models).toContain("gpt-4o");
  });
});

describe("FallbackHandler integration", () => {
  let mockUpstreamServer: ReturnType<typeof Bun.serve>;
  let mockUpstreamUrl: string;
  const upstreamRequests: Array<{ path: string; body: unknown }> = [];

  beforeAll(() => {
    mockUpstreamServer = Bun.serve({
      port: 0,
      fetch: async (req) => {
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
      },
    });
    mockUpstreamUrl = `http://localhost:${mockUpstreamServer.port}`;
  });

  afterAll(() => {
    mockUpstreamServer.stop();
  });

  beforeEach(() => {
    upstreamRequests.length = 0;
  });

  test("should apply fallback handler to POST endpoints", async () => {
    let localHandlerCalled = false;

    const handlers: ProviderHandlers = {
      openai: async () => {
        localHandlerCalled = true;
        return new Response(JSON.stringify({ source: "local" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    };

    const mockProxy = createUpstreamProxy({ targetUrl: mockUpstreamUrl });
    const providerChecker: ProviderChecker = () => false; // No local providers
    const fallbackHandler = new FallbackHandler(
      () => mockProxy,
      providerChecker
    );

    const routes = createAmpRoutes({
      handlers,
      fallbackHandler,
    });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      }
    );

    const response = await router(request);
    const data: any = await response.json();

    expect(localHandlerCalled).toBe(false);
    expect(data.source).toBe("upstream");
    expect(upstreamRequests.length).toBe(1);
  });

  test("should use local handler when provider available", async () => {
    let localHandlerCalled = false;

    const handlers: ProviderHandlers = {
      openai: async () => {
        localHandlerCalled = true;
        return new Response(JSON.stringify({ source: "local" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    };

    const mockProxy = createUpstreamProxy({ targetUrl: mockUpstreamUrl });
    const providerChecker: ProviderChecker = (model) => model === "gpt-4o"; // Has local provider
    const fallbackHandler = new FallbackHandler(
      () => mockProxy,
      providerChecker
    );

    const routes = createAmpRoutes({
      handlers,
      fallbackHandler,
    });
    const router = createRouter(routes);

    const request = new Request(
      "http://localhost/api/provider/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      }
    );

    const response = await router(request);
    const data: any = await response.json();

    expect(localHandlerCalled).toBe(true);
    expect(data.source).toBe("local");
    expect(upstreamRequests.length).toBe(0);
  });
});

describe("Server integration", () => {
  let server: LlmuxServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("should register amp routes on server startup with enableAmp", async () => {
    const ampConfig: AmpConfig = {
      handlers: {
        openai: async () =>
          new Response(JSON.stringify({ source: "amp-openai" }), {
            headers: { "Content-Type": "application/json" },
          }),
      },
    };

    server = await startServer({ port: 0, amp: ampConfig });

    const response = await fetch(
      `http://localhost:${server.port}/api/provider/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      }
    );

    expect(response.ok).toBe(true);
    const data: any = await response.json();
    expect(data.source).toBe("amp-openai");
  });

  test("should still serve default routes when amp is enabled", async () => {
    const ampConfig: AmpConfig = {
      handlers: {
        openai: async () => new Response("ok"),
      },
    };

    server = await startServer({ port: 0, amp: ampConfig });

    const response = await fetch(`http://localhost:${server.port}/health`);
    expect(response.ok).toBe(true);
    const data: any = await response.json();
    expect(data.status).toBe("ok");
  });
});
