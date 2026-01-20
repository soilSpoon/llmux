import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import {
  createUnifiedRequest,
  createUnifiedMessage,
  createUnifiedResponse,
  createUnifiedTool,
} from "../_utils/fixtures";
import {
  type AntigravityProviderRequest,
  isAntigravityProviderRequest,
  type AntigravityResponse,
} from "../../../src/formats/gemini/antigravity/types";

// Helper for strict typing in tests
function getAntigravityRequest(val: unknown): AntigravityProviderRequest {
  if (isAntigravityProviderRequest(val)) return val;
  throw new Error('Expected AntigravityProviderRequest');
}

describe("AntigravityProvider", () => {
  const provider = new AntigravityProvider();

  describe("provider metadata", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("antigravity");
    });

    it("should have correct config", () => {
      expect(provider.config.name).toBe("antigravity");
      expect(provider.config.supportsStreaming).toBe(true);
      expect(provider.config.supportsThinking).toBe(true);
    });
  });

  describe("parse()", () => {
    it("should parse a simple Antigravity request", () => {
      const antigravityRequest: AntigravityProviderRequest = {
        project: "test-project",
        location: "us-central1",
        model: "gemini-2.0-flash",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.role).toBe("user");
      const firstPart = result.messages[0]?.parts[0];
      if (firstPart && firstPart.type === 'text') {
          expect(firstPart.text).toBe("Hello");
      } else {
          throw new Error('Expected text part');
      }
    });

    it("should extract metadata from wrapper", () => {
      const antigravityRequest: AntigravityProviderRequest = {
        project: "my-project",
        location: "global",
        model: "claude-sonnet-4-5",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          sessionId: "session-abc",
        },
      };

      const result = provider.parse(antigravityRequest);

      // Metadata is extracted from both wrapper and inner request
      expect(result.metadata?.project).toBe("my-project");
      expect(result.metadata?.model).toBe("claude-sonnet-4-5");
      expect(result.metadata?.sessionId).toBe("session-abc");
    });

    it("should parse system instruction", () => {
      const antigravityRequest: AntigravityProviderRequest = {
        project: "test-project",
        location: "global",
        model: "gemini-2.0-flash",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          system_instruction: { parts: [{ text: "Be helpful." }] },
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.system).toBe("Be helpful.");
    });

    it("should parse tools", () => {
      const antigravityRequest: AntigravityProviderRequest = {
        project: "test-project",
        location: "global",
        model: "gemini-2.0-flash",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          tools: [
            {
              functionDeclarations: [
                {
                  name: "search",
                  description: "Search the web",
                  parameters: { type: "OBJECT", properties: {} },
                },
              ],
            },
          ],
        },
      };

      const result = provider.parse(antigravityRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools?.[0]?.name).toBe("search");
    });
  });

  describe("transform()", () => {
    it("should transform a simple UnifiedRequest", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
      });

      const result = getAntigravityRequest(provider.transform(request, 'gemini-2.0-flash'));

      expect(result.project).toBeDefined();
      expect(result.model).toBeDefined();
      const firstPart = result.request.contents[0]?.parts[0];
      if (firstPart && 'text' in firstPart) {
        expect(firstPart.text).toBe("Hello");
      } else {
        throw new Error('Expected text part in request payload');
      }
    });

    it("should use metadata for wrapper fields", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        metadata: {
          project: "custom-project",
          model: "claude-sonnet-4-5",
          sessionId: "session-xyz",
        },
      });

      const result = getAntigravityRequest(provider.transform(request, 'claude-sonnet-4-5'));

      expect(result.project).toBe("custom-project");
      expect(result.model).toBe("claude-sonnet-4-5");
      expect(result.request.sessionId).toBe("session-xyz");
    });

    it("should transform tools with VALIDATED mode", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        tools: [createUnifiedTool("test_tool", "A test tool")],
      });

      const result = getAntigravityRequest(provider.transform(request, 'claude-sonnet-4-5'));

      expect(result.request.tools).toHaveLength(1);
      if (result.request.tool_config?.function_calling_config) {
        expect(result.request.tool_config.function_calling_config.mode).toBe("VALIDATED");
      } else {
          throw new Error('Expected toolConfig with VALIDATED mode');
      }
    });
  });

  describe("parseResponse()", () => {
    it("should parse a simple Antigravity response", () => {
      const response: AntigravityResponse = {
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hello!" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
        },
      };

      const result = provider.parseResponse(response);

      const firstPart = result.content[0];
      if (firstPart && firstPart.type === 'text') {
          expect(firstPart.text).toBe("Hello!");
      }
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
    });

    it("should parse tool calls", () => {
      const response: AntigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "get_weather",
                      args: { location: "NYC" },
                      id: "call-123",
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      };

      const result = provider.parseResponse(response);

      const firstPart = result.content[0];
      if (firstPart && firstPart.type === 'tool_call') {
          expect(firstPart.toolCall?.name).toBe("get_weather");
      } else {
          throw new Error('Expected tool_call part');
      }
      expect(result.stopReason).toBe("tool_use");
    });
  });

  describe("transformResponse()", () => {
    it("should transform a simple UnifiedResponse", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
      });

      const result = provider.transformResponse(response);
      const antResponse = result as AntigravityResponse;

      const candidate = antResponse.response.candidates?.[0];
      if (!candidate) throw new Error('Candidate missing');
      
      const parts = candidate.content?.parts;
      if (!parts || parts.length === 0) throw new Error('Parts missing');
      
      const firstPart = parts[0];
      if (firstPart && 'text' in firstPart) {
        expect(firstPart.text).toBe("Hello!");
      } else {
          throw new Error('Expected text part in response');
      }
      expect(candidate.finishReason).toBe("STOP");
    });
  });
});
