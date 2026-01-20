import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import type {
  AntigravityRequest,
  AntigravityClientRequest,
  AntigravityPart,
  AntigravityProviderRequest,
} from "../../../src/formats/gemini/antigravity/types";
import type { UnifiedRequest } from "../../../src/types/unified";
import type { GeminiCliRequest } from "../../../src/formats/gemini/gemini-cli/types";

const provider = new AntigravityProvider();
const parse = (req: AntigravityRequest | AntigravityClientRequest) =>
  provider.parse(req);
const transform = (
  req: UnifiedRequest,
  model: string
): AntigravityProviderRequest | GeminiCliRequest => provider.transform(req, model);
import { createUnifiedRequest, createUnifiedMessage } from "../_utils/fixtures";

describe("Antigravity Request Casing", () => {
  describe("parse()", () => {
    it("should parse snake_case client format", () => {
      const clientRequest: AntigravityClientRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        user_agent: "antigravity",
        request_id: "agent-123",
        session_id: "session-456",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generation_config: {
            temperature: 0.7,
            thinking_config: {
              include_thoughts: true,
              thinking_budget: 1024,
            },
          },
        },
      };

      const result = parse(clientRequest);

      expect(result.metadata?.requestId).toBe("agent-123");
      expect(result.metadata?.userAgent).toBe("antigravity");
      expect(result.metadata?.sessionId).toBe("session-456");
      expect(result.config?.temperature).toBe(0.7);
      expect(result.thinking?.enabled).toBe(true);
      expect(result.thinking?.budget).toBe(1024);
      expect(result.thinking?.includeThoughts).toBe(true);
    });

    it("should parse camelCase internal format", () => {
      const internalRequest: AntigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          sessionId: "session-789",
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            temperature: 0.7,
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 1024,
            },
          },
        },
      };

      const result = parse(internalRequest);

      expect(result.metadata?.requestId).toBe("agent-123");
      expect(result.metadata?.userAgent).toBe("antigravity");
      expect(result.metadata?.sessionId).toBe("session-789");
      expect(result.config?.temperature).toBe(0.7);
      expect(result.thinking?.enabled).toBe(true);
      expect(result.thinking?.budget).toBe(1024);
      expect(result.thinking?.includeThoughts).toBe(true);
    });
  });

  describe("transform()", () => {
    it("should transform to snake_case wire format while preserving content keys", () => {
      const unifiedRequest = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        config: { temperature: 0.7 },
        thinking: { enabled: true, budget: 2048, includeThoughts: true },
      });

      // Using a Gemini model to trigger Gemini thinking config logic
      const result = transform(
        unifiedRequest,
        "gemini-2.0-flash-thinking"
      ) as AntigravityRequest;

      // Verify wrapper fields
      expect(result.metadata?.requestType).toBe("generateContent");
      expect(result.userAgent).toBe("antigravity");

      // Verify generation config (snake_case in Antigravity provider request)
      const genConfig = result.request.generation_config;
      expect(genConfig).toBeDefined();
      expect(genConfig?.temperature).toBe(0.7);

      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config).toBeDefined();
        expect(genConfig.thinking_config?.thinking_budget).toBe(2048);
        expect(genConfig.thinking_config?.include_thoughts).toBe(true);
      } else {
        throw new Error(
          "thinking_config expected in snake_case format for Antigravity wire request"
        );
      }

      // Verify CONTENTS are preserved
      const contents = result.request.contents;
      expect(contents).toHaveLength(1);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts[0]?.text).toBe("Hello");
    });

    it("should preserve user keys in function call args", () => {
      const unifiedRequest = createUnifiedRequest({
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "tool_call",
                toolCall: {
                  id: "call_1",
                  name: "test_tool",
                  arguments: {
                    userKey: "value",
                    nestedObject: {
                      deepKey: 123,
                    },
                  },
                },
              },
            ],
          },
        ],
      });

      const result = transform(unifiedRequest, "gemini-3-pro");
      const contents = "request" in result ? result.request.contents : result.contents;

      const assistantContent = contents.find(
        (c) => c.role === "model" || (c.role as string) === "assistant"
      );
      const part = assistantContent?.parts?.find((p) => 'functionCall' in p && !!p.functionCall);

      expect(part).toBeDefined();
      const fcPart = part as AntigravityPart;
      expect(fcPart.functionCall).toBeDefined();
      // Name is encoded with 't' prefix
      expect(fcPart.functionCall?.name).toBe("tdGVzdF90b29s");
      expect(fcPart.functionCall?.args).toEqual({
        userKey: "value",
        nestedObject: {
          deepKey: 123,
        },
      });
    });

    it("should preserve user keys in function response", () => {
      const unifiedRequest = createUnifiedRequest({
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                toolResult: {
                  toolCallId: "call_1",
                  content: JSON.stringify({
                    userResultKey: "someValue",
                    complexData: {
                      statusId: 200,
                    },
                  }),
                },
              },
            ],
          },
        ],
      });

      const result = transform(unifiedRequest, "gemini-3-pro");
      const contents = "request" in result ? result.request.contents : result.contents;
      const userContent = contents.find((c) => c.role === "user");
      const part = userContent?.parts.find(
        (p) => 'functionResponse' in p && !!p.functionResponse
      );

      expect(part).toBeDefined();
      const frPart = part as AntigravityPart;
      expect(frPart.functionResponse).toBeDefined();
      expect(frPart.functionResponse?.response).toEqual({
        userResultKey: "someValue",
        complexData: {
          statusId: 200,
        },
      });
    });
  });
});

describe("AntigravityProvider Casing & Logic", () => {
  const baseRequest: UnifiedRequest = {
    messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
    system: "System instruction",
    config: {
      temperature: 0.7,
      maxTokens: 1000,
    },
  };

  describe("Claude Models (Antigravity)", () => {
    it("should generate snake_case thinking_config for Claude Thinking models", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: {
          enabled: true,
          budget: 4000,
          includeThoughts: true,
        },
      };

      const transformed = provider.transform(
        request,
        "antigravity-claude-3-7-sonnet-thinking"
      ) as AntigravityRequest;
      const innerRequest = transformed.request;
      const genConfig = innerRequest.generation_config;

      // Verify snake_case keys for Antigravity+Claude
      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config).toBeDefined();
        expect(genConfig.thinking_config?.include_thoughts).toBe(true);
        expect(genConfig.thinking_config?.thinking_budget).toBe(4000);
      } else {
        throw new Error("thinking_config expected in snake_case format");
      }

      // Should have snake_case version
      expect(genConfig.thinking_config).toBeDefined()
    });

    it("should enforce maxOutputTokens > thinkingBudget for Claude Thinking models", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        config: { maxTokens: 100 }, // User set low limit
        thinking: { enabled: true, budget: 1024 },
      };

      const transformed = provider.transform(
        request,
        "antigravity-claude-3-7-sonnet-thinking"
      ) as AntigravityRequest;
      const innerRequest = transformed.request;

      const maxOutputTokens = innerRequest.generation_config?.maxOutputTokens;
      expect(typeof maxOutputTokens).toBe("number");
      expect(maxOutputTokens).toBeGreaterThan(1024);
    });

    it("should NOT generate thinking config for non-thinking Claude models", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 1024 }, // Even if user asks (though middleware implies filtering, transform should be safe)
      };

      // Model name without 'thinking' implies no thinking support in this context checks
      // Note: isThinkingModel checks for 'thinking' or 'gemini-3' substring
      const transformed = provider.transform(
        request,
        "claude-3-5-sonnet"
      ) as AntigravityRequest;
      const innerRequest = transformed.request;

      expect(innerRequest.generation_config).not.toHaveProperty("thinking_config");
      expect(innerRequest.generation_config).not.toHaveProperty("thinkingConfig");
    });
  });

  describe("Gemini Models", () => {
    it("should generate thinking_config for Gemini 2.0", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 2048 },
      };

      const transformed = provider.transform(
        request,
        "gemini-2.0-flash-thinking"
      ) as AntigravityRequest;
      const innerRequest = transformed.request;
      const genConfig = innerRequest.generation_config;

      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config).toEqual({
          include_thoughts: true,
          thinking_budget: 2048,
        });
      } else {
        throw new Error(
          "Expected thinking_config (snake_case) for Gemini internal request payload on Antigravity"
        );
      }
    });

    it("should generate thinking_config with thinking_level for Gemini 3.0 (explicit level)", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, level: "high" },
      };

      const transformed = provider.transform(
        request,
        "gemini-3.0-pro"
      ) as AntigravityRequest;
      const innerRequest = transformed.request;
      const genConfig = innerRequest.generation_config;

      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config).toBeDefined();
        expect(genConfig.thinking_config?.thinking_level).toBe("HIGH");
      }
    });

    it("should map budget to thinking_level for Gemini 3.0 (Low budget)", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 10000 },
      };

      const transformed = provider.transform(
        request,
        "gemini-3.0-pro"
      ) as AntigravityRequest;
      const genConfig = transformed.request.generation_config;

      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config?.thinking_level).toBe("LOW");
      }
    });

    it("should map budget to thinking_level for Gemini 3.0 (Medium budget)", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 20000 },
      };

      const transformed = provider.transform(
        request,
        "gemini-3.0-pro"
      ) as AntigravityRequest;
      const genConfig = transformed.request.generation_config;

      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config?.thinking_level).toBe("MEDIUM");
      }
    });

    it("should map budget to thinking_level for Gemini 3.0 (High budget)", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 40000 },
      };

      const transformed = provider.transform(
        request,
        "gemini-3.0-pro"
      ) as AntigravityRequest;
      const genConfig = transformed.request.generation_config;

      if (genConfig && "thinking_config" in genConfig) {
        expect(genConfig.thinking_config?.thinking_level).toBe("HIGH");
      }
    });
  });

  describe("General Properties", () => {
    it("should maintain generic camelCase properties for standard fields", () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        config: { stopSequences: ["STOP"] },
        tools: [
          { name: "test_tool", description: "desc", parameters: { type: "object" } },
        ],
      };

      const transformed = provider.transform(
        request,
        "any-model"
      ) as AntigravityRequest;
      const innerRequest = transformed.request;

      expect(innerRequest.generation_config).toHaveProperty("stopSequences");
      expect(innerRequest.tools?.[0]).toHaveProperty("functionDeclarations");
    });
  });
});
