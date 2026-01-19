import { describe, expect, it } from "bun:test";
import { parse, transform } from "../../../src/providers/antigravity/request";
import type { AntigravityWireRequest, AntigravityRequest } from "../../../src/providers/antigravity/types";
import {
  createUnifiedRequest,
  createUnifiedMessage,
} from "../_utils/fixtures";

describe("Antigravity Request Casing", () => {
  describe("parse()", () => {
    it("should parse snake_case wire format", () => {
      const wireRequest: AntigravityWireRequest = {
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

      const result = parse(wireRequest);

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
        messages: [
          createUnifiedMessage("user", "Hello"),
        ],
        config: { temperature: 0.7 },
        thinking: { enabled: true, budget: 2048, includeThoughts: true },
      });

      // Using a Gemini model to trigger Gemini thinking config logic
      const result = transform(unifiedRequest, 'gemini-3-pro') as AntigravityWireRequest;

      // Verify wrapper fields
      expect(result.request_type).toBe('agent');
      expect(result.user_agent).toBe('antigravity');

      // Verify snake_case conversion of generation config
      const genConfig = result.request.generation_config;
      expect(genConfig).toBeDefined();
      expect(genConfig?.temperature).toBe(0.7);
      expect(genConfig?.thinking_config).toBeDefined();
      expect(genConfig?.thinking_config?.thinking_budget).toBe(2048);
      expect(genConfig?.thinking_config?.include_thoughts).toBe(true);

      // Verify CONTENTS are preserved (camelCase)
      const contents = result.request.contents;
      expect(contents).toHaveLength(1);
      expect(contents[0]?.role).toBe('user'); // Should NOT be 'role' -> converted
      expect(contents[0]?.parts[0]?.text).toBe("Hello");
      // Key check: make sure we didn't accidentally convert 'parts' to something else or keys inside it
      // The Gemini format uses 'parts', 'text', 'role' which are all lowercase single words, 
      // but let's check a multi-word key if possible.
      // Inline data uses 'inlineData', function call uses 'functionCall'.
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
                      deepKey: 123
                    }
                  }
                }
              }
            ]
          }
        ]
      });

      const result = transform(unifiedRequest, 'gemini-3-pro') as AntigravityWireRequest;
      const part = result.request.contents[0]?.parts[0];
      
      expect(part?.functionCall).toBeDefined();
      // Verify args keys are NOT snake_cased
      expect(part?.functionCall?.args).toEqual({
        userKey: "value",
        nestedObject: {
          deepKey: 123
        }
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
                      statusId: 200
                    }
                  })
                }
              }
            ]
          }
        ]
      });

      const result = transform(unifiedRequest, 'gemini-3-pro') as AntigravityWireRequest;
      const part = result.request.contents[0]?.parts[0];
      
      expect(part?.functionResponse).toBeDefined();
      // Verify response keys are NOT snake_cased
      expect(part?.functionResponse?.response).toEqual({
        userResultKey: "someValue",
        complexData: {
          statusId: 200
        }
      });
    });
  });
});
