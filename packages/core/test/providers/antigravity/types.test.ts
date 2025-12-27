import { describe, expect, it } from "bun:test";
import {
  type AntigravityRequest,
  type AntigravityResponse,
  type AntigravityInnerRequest,
  type AntigravityStreamChunk,
  isAntigravityRequest,
  isAntigravityResponse,
  isAntigravityStreamChunk,
} from "../../../src/providers/antigravity/types";

describe("Antigravity Types", () => {
  describe("AntigravityRequest", () => {
    it("should have wrapper fields", () => {
      const request: AntigravityRequest = {
        project: "rising-fact-p41fc",
        model: "claude-sonnet-4-5-thinking",
        userAgent: "antigravity",
        requestId: "agent-550e8400-e29b-41d4-a716-446655440000",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      };
      expect(request.project).toBe("rising-fact-p41fc");
      expect(request.model).toBe("claude-sonnet-4-5-thinking");
      expect(request.userAgent).toBe("antigravity");
    });

    it("should have inner Gemini-style request", () => {
      const request: AntigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            maxOutputTokens: 1000,
          },
        },
      };
      expect(request.request.contents).toHaveLength(1);
      expect(request.request.generationConfig?.maxOutputTokens).toBe(1000);
    });

    it("should support sessionId in inner request", () => {
      const request: AntigravityRequest = {
        project: "test-project",
        model: "claude-sonnet-4-5",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          sessionId: "session-abc123",
        },
      };
      expect(request.request.sessionId).toBe("session-abc123");
    });

    it("should support VALIDATED mode in toolConfig", () => {
      const request: AntigravityRequest = {
        project: "test-project",
        model: "claude-sonnet-4-5",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          toolConfig: {
            functionCallingConfig: {
              mode: "VALIDATED",
            },
          },
        },
      };
      expect(request.request.toolConfig?.functionCallingConfig?.mode).toBe(
        "VALIDATED"
      );
    });

    it("should support thinkingConfig for Claude thinking models", () => {
      const request: AntigravityRequest = {
        project: "test-project",
        model: "claude-sonnet-4-5-thinking",
        userAgent: "antigravity",
        requestId: "agent-123",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            maxOutputTokens: 64000,
            thinkingConfig: {
              include_thoughts: true,
              thinking_budget: 16384,
            },
          },
        },
      };
      expect(
        request.request.generationConfig?.thinkingConfig?.include_thoughts
      ).toBe(true);
      expect(
        request.request.generationConfig?.thinkingConfig?.thinking_budget
      ).toBe(16384);
    });
  });

  describe("AntigravityInnerRequest", () => {
    it("should extend Gemini request with sessionId", () => {
      const inner: AntigravityInnerRequest = {
        contents: [{ role: "model", parts: [{ text: "Response" }] }],
        sessionId: "session-123",
      };
      expect(inner.sessionId).toBe("session-123");
    });

    it("should support thinking signature in parts", () => {
      const inner: AntigravityInnerRequest = {
        contents: [
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Thinking...",
                thoughtSignature: "sig123",
              },
              { text: "Answer" },
            ],
          },
        ],
      };
      expect(inner.contents[0]!.parts[0]!.thoughtSignature).toBe("sig123");
    });
  });

  describe("AntigravityResponse", () => {
    it("should wrap Gemini response", () => {
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
      expect(response.response.candidates).toHaveLength(1);
    });

    it("should support optional traceId", () => {
      const response: AntigravityResponse = {
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hi" }] },
              finishReason: "STOP",
            },
          ],
        },
        traceId: "trace-abc123",
      };
      expect(response.traceId).toBe("trace-abc123");
    });

    it("should support thinking blocks with signatures", () => {
      const response: AntigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    thought: true,
                    text: "Let me analyze...",
                    thoughtSignature: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                  },
                  { text: "Here is my answer." },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      };
      const parts = response.response.candidates[0]!.content.parts;
      expect(parts[0]!.thought).toBe(true);
      expect(parts[0]!.thoughtSignature).toBeDefined();
    });

    it("should support functionCall with id", () => {
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
                    thoughtSignature: "skip_thought_signature_validator",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      };
      const fc =
        response.response.candidates[0]!.content.parts[0]!.functionCall;
      expect(fc?.id).toBe("call-123");
    });
  });

  describe("AntigravityStreamChunk", () => {
    it("should wrap streaming response", () => {
      const chunk: AntigravityStreamChunk = {
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hel" }] },
            },
          ],
        },
      };
      expect(chunk.response.candidates[0]!.content.parts[0]!.text).toBe("Hel");
    });

    it("should support usage in final chunk", () => {
      const chunk: AntigravityStreamChunk = {
        response: {
          candidates: [
            {
              content: { role: "model", parts: [] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 500,
            totalTokenCount: 600,
            cachedContentTokenCount: 50,
          },
        },
      };
      expect(chunk.response.usageMetadata?.cachedContentTokenCount).toBe(50);
    });
  });

  describe("Type Guards", () => {
    describe("isAntigravityRequest", () => {
      it("should return true for valid Antigravity request", () => {
        const request = {
          project: "test-project",
          model: "claude-sonnet-4-5",
          userAgent: "antigravity",
          requestId: "agent-123",
          request: {
            contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          },
        };
        expect(isAntigravityRequest(request)).toBe(true);
      });

      it("should return false for missing project", () => {
        const request = {
          model: "claude-sonnet-4-5",
          userAgent: "antigravity",
          requestId: "agent-123",
          request: { contents: [] },
        };
        expect(isAntigravityRequest(request)).toBe(false);
      });

      it("should return false for missing inner request", () => {
        const request = {
          project: "test-project",
          model: "claude-sonnet-4-5",
          userAgent: "antigravity",
          requestId: "agent-123",
        };
        expect(isAntigravityRequest(request)).toBe(false);
      });

      it("should return false for non-object", () => {
        expect(isAntigravityRequest(null)).toBe(false);
        expect(isAntigravityRequest("string")).toBe(false);
      });

      it("should distinguish from plain Gemini request", () => {
        const geminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        };
        expect(isAntigravityRequest(geminiRequest)).toBe(false);
      });
    });

    describe("isAntigravityResponse", () => {
      it("should return true for valid Antigravity response", () => {
        const response = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: "Hi" }] },
                finishReason: "STOP",
              },
            ],
          },
        };
        expect(isAntigravityResponse(response)).toBe(true);
      });

      it("should return false for unwrapped Gemini response", () => {
        const geminiResponse = {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hi" }] },
              finishReason: "STOP",
            },
          ],
        };
        expect(isAntigravityResponse(geminiResponse)).toBe(false);
      });

      it("should return false for missing response field", () => {
        const invalid = { traceId: "trace-123" };
        expect(isAntigravityResponse(invalid)).toBe(false);
      });
    });

    describe("isAntigravityStreamChunk", () => {
      it("should return true for valid stream chunk", () => {
        const chunk = {
          response: {
            candidates: [
              { content: { role: "model", parts: [{ text: "Hi" }] } },
            ],
          },
        };
        expect(isAntigravityStreamChunk(chunk)).toBe(true);
      });

      it("should return false for unwrapped Gemini chunk", () => {
        const geminiChunk = {
          candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }],
        };
        expect(isAntigravityStreamChunk(geminiChunk)).toBe(false);
      });
    });
  });
});
