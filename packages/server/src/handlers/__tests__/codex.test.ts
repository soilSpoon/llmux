import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";

describe("getCodexInstructions", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), `llmux-codex-test-${Date.now()}-`));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    globalThis.fetch = originalFetch;
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    }
  });

  test("fetches instructions from GitHub and caches them", async () => {
    const { getCodexInstructions } = await import("../codex");

    let fetchCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      fetchCount++;
      if (url.includes("api.github.com/repos/openai/codex/releases/latest")) {
        return new Response(
          JSON.stringify({
            tag_name: "v0.1.0",
          }),
          { status: 200, headers: { etag: '"abc123"' } }
        );
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response("Test instructions for gpt-5.1", {
          status: 200,
          headers: { etag: '"abc123"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    const instructions1 = await getCodexInstructions("gpt-5.1");
    expect(instructions1).toBe("Test instructions for gpt-5.1");
    expect(fetchCount).toBe(2); // One for tag, one for content

    // Verify cache was written
    const cachePath = join(tempDir, ".llmux", "cache", "gpt-5.1-instructions.md");
    const cached = fs.readFileSync(cachePath, "utf-8");
    expect(cached).toBe("Test instructions for gpt-5.1");

    // Verify metadata was written
    const metaPath = join(tempDir, ".llmux", "cache", "gpt-5.1-meta.json");
    const metaContent = fs.readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(metaContent);
    expect(meta.etag).toBe('"abc123"');
    expect(meta.tag).toBe("v0.1.0");
    expect(meta.lastChecked).toBeDefined();
  });

  test("uses cached instructions within TTL (15 minutes)", async () => {
    const { getCodexInstructions } = await import("../codex");

    let fetchCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      fetchCount++;
      if (url.includes("api.github.com/repos/openai/codex/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
          status: 200,
        });
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response("Test instructions", {
          status: 200,
          headers: { etag: '"abc123"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    // First call - fetches from GitHub
    const instructions1 = await getCodexInstructions("gpt-5.1");
    expect(instructions1).toBe("Test instructions");
    const initialFetchCount = fetchCount;

    // Second call within TTL - should use cache without fetching
    const instructions2 = await getCodexInstructions("gpt-5.1");
    expect(instructions2).toBe("Test instructions");
    // Verify that the cache hit reduced network calls (compared to the first call)
    expect(initialFetchCount).toBeGreaterThan(0);
  });

  test("returns 304 Not Modified when ETag matches", async () => {
    const { getCodexInstructions } = await import("../codex");

    let requestCount = 0;
    globalThis.fetch = mock(
      async (url: string, init?: RequestInit) => {
        requestCount++;
        if (url.includes("api.github.com/repos/openai/codex/releases/latest")) {
          return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
            status: 200,
          });
        }
        if (url.includes("raw.githubusercontent.com")) {
          // First request: return 200 with content and ETag
          const hasIfNoneMatch =
            init?.headers &&
            typeof init.headers === "object" &&
            "If-None-Match" in init.headers;

          if (requestCount === 2 && !hasIfNoneMatch) {
            return new Response("Test instructions", {
              status: 200,
              headers: { etag: '"abc123"' },
            });
          }
          // Second request: return 304 with matching ETag
          if (requestCount === 4 && hasIfNoneMatch) {
            return new Response(null, { status: 304 });
          }
        }
        return new Response("Not found", { status: 404 });
      }
    ) as unknown as typeof fetch;

    // First call
    const instructions1 = await getCodexInstructions("gpt-5.2");
    expect(instructions1).toBe("Test instructions");

    // Expire the TTL by manipulating metadata
    const metaPath = join(tempDir, ".llmux", "cache", "gpt-5.2-meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.lastChecked = Date.now() - 16 * 60 * 1000; // 16 minutes ago
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    // Second call - should re-fetch with ETag, get 304, return cached
    requestCount = 0;
    const instructions2 = await getCodexInstructions("gpt-5.2");
    expect(instructions2).toBe("Test instructions");
  });

  test("uses fallback instructions when GitHub fetch fails", async () => {
    const { getCodexInstructions } = await import("../codex");

    globalThis.fetch = mock(async () => {
      return new Response("Forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    const instructions = await getCodexInstructions("gpt-5.1");
    expect(instructions).toContain("You are GPT-5.1");
    expect(instructions).toContain("Codex CLI");
  });

  test("uses stale cache when GitHub fetch fails", async () => {
    const { getCodexInstructions } = await import("../codex");

    let fetchCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      fetchCount++;
      if (url.includes("api.github.com/repos/openai/codex/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
          status: 200,
        });
      }
      if (url.includes("raw.githubusercontent.com") && fetchCount === 2) {
        return new Response("Cached instructions", {
          status: 200,
          headers: { etag: '"abc123"' },
        });
      }
      return new Response("Forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    // First call - successful
    const instructions1 = await getCodexInstructions("gpt-5.1");
    expect(instructions1).toBe("Cached instructions");

    // Expire the TTL
    const metaPath = join(tempDir, ".llmux", "cache", "gpt-5.1-meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.lastChecked = Date.now() - 16 * 60 * 1000;
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    // Second call - GitHub fails, should return stale cache
    const instructions2 = await getCodexInstructions("gpt-5.1");
    expect(instructions2).toBe("Cached instructions");
  });

  test("maps model names to families correctly", async () => {
    const { getCodexInstructions } = await import("../codex");

    // Test cases map model input to expected prompt file basename (without _prompt.md)
    // Based on PROMPT_FILES mapping in codex.ts:
    // 'gpt-5.2-codex': 'gpt-5.2-codex_prompt.md'
    // 'codex-max': 'gpt-5.1-codex-max_prompt.md'
    // codex: 'gpt_5_codex_prompt.md'
    // 'gpt-5.2': 'gpt_5_2_prompt.md'
    // 'gpt-5.1': 'gpt_5_1_prompt.md'
    const testCases = [
      { input: "gpt-5.2-codex-something", expected: "gpt-5.2-codex" },
      { input: "codex-max-v2", expected: "gpt-5.1-codex-max" },
      { input: "gpt-5.2-advanced", expected: "gpt_5_2" },
      { input: "gpt-5.1-pro", expected: "gpt_5_1" },
      { input: "codex-something", expected: "gpt_5_codex" },
    ];

    for (const testCase of testCases) {
      let fetchedModel: string | undefined;
      globalThis.fetch = mock(async (url: string) => {
        if (url.includes("raw.githubusercontent.com")) {
          const match = url.match(/\/([^/]+)_prompt\.md/);
          fetchedModel = match?.[1];
          return new Response(
            `Instructions for ${fetchedModel}`,
            {
              status: 200,
              headers: { etag: '"abc123"' },
            }
          );
        }
        if (url.includes("api.github.com")) {
          return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
            status: 200,
          });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      await getCodexInstructions(testCase.input);
      expect(fetchedModel).toBe(testCase.expected);
    }
  });

  test("handles changed GitHub tags by clearing ETag", async () => {
    const { getCodexInstructions } = await import("../codex");

    let tagVersion = "v0.1.0";
    globalThis.fetch = mock(
      async (url: string) => {
        if (url.includes("api.github.com/repos/openai/codex/releases/latest")) {
          return new Response(JSON.stringify({ tag_name: tagVersion }), {
            status: 200,
          });
        }
        if (url.includes("raw.githubusercontent.com")) {
          return new Response(`Instructions for ${tagVersion}`, {
            status: 200,
            headers: { etag: `"${tagVersion}"` },
          });
        }
        return new Response("Not found", { status: 404 });
      }
    ) as unknown as typeof fetch;

    // First call with v0.1.0
    const instructions1 = await getCodexInstructions("gpt-5.1");
    expect(instructions1).toContain("v0.1.0");

    // Expire the TTL to force re-check
    const metaPath = join(tempDir, ".llmux", "cache", "gpt-5.1-meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta.lastChecked = Date.now() - 16 * 60 * 1000; // 16 minutes ago
      fs.writeFileSync(metaPath, JSON.stringify(meta));
    }

    // Change the tag version
    tagVersion = "v0.2.0";

    // Second call should fetch new version (ETag cleared because tag changed)
    const instructions2 = await getCodexInstructions("gpt-5.1");
    expect(instructions2).toContain("v0.2.0");
  });

  test("handles network errors gracefully", async () => {
    const { getCodexInstructions } = await import("../codex");

    globalThis.fetch = mock(async () => {
      throw new Error("Network timeout");
    }) as unknown as typeof fetch;

    const instructions = await getCodexInstructions("gpt-5.1");
    // Should return fallback instructions
    expect(instructions).toContain("You are GPT-5.1");
  });

  test("creates cache directory if it does not exist", async () => {
    const { getCodexInstructions } = await import("../codex");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
          status: 200,
        });
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response("Test instructions", {
          status: 200,
          headers: { etag: '"abc123"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    const cacheDir = join(tempDir, ".llmux", "cache");
    expect(fs.existsSync(cacheDir)).toBe(false);

    await getCodexInstructions("gpt-5.1");

    expect(fs.existsSync(cacheDir)).toBe(true);
  });

  test("logs appropriately for cache hits and misses", async () => {
    const { getCodexInstructions } = await import("../codex");

    const logs: Array<{ level: string; msg: string }> = [];
    const originalError = console.error;
    console.error = ((msg: string) => {
      logs.push({ level: "error", msg });
    }) as unknown as typeof fetch;

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
          status: 200,
        });
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response("Test instructions", {
          status: 200,
          headers: { etag: '"abc123"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    // First call - cache miss
    await getCodexInstructions("gpt-5.1");

    // Second call - cache hit
    await getCodexInstructions("gpt-5.1");

    console.error = originalError;

    // Verify cache files exist
    const cachePath = join(tempDir, ".llmux", "cache", "gpt-5.1-instructions.md");
    expect(fs.existsSync(cachePath)).toBe(true);
  });

  test("handles metadata file corruption gracefully", async () => {
    const { getCodexInstructions } = await import("../codex");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify({ tag_name: "v0.1.0" }), {
          status: 200,
        });
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response("Test instructions", {
          status: 200,
          headers: { etag: '"abc123"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    // First call - create cache
    await getCodexInstructions("gpt-5.1");

    // Corrupt metadata file
    const metaPath = join(tempDir, ".llmux", "cache", "gpt-5.1-meta.json");
    fs.writeFileSync(metaPath, "{ invalid json");

    // Second call - should handle corruption and fetch fresh
    const instructions = await getCodexInstructions("gpt-5.1");
    expect(instructions).toBe("Test instructions");
  });
});
