import { describe, expect, it } from "bun:test";
import {
  type GeminiRequest,
  type GeminiResponse,
  type GeminiContent,
  type GeminiPart,
  type GeminiTool,
  type GeminiStreamChunk,
  isGeminiRequest,
  isGeminiResponse,
  isGeminiContent,
  isGeminiStreamChunk,
} from "../../../src/providers/gemini/types";

describe("Gemini Types", () => {
  describe("GeminiRequest", () => {
    it("should have required contents field", () => {
      const request: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      };
      expect(request.contents).toHaveLength(1);
    });

    it("should support systemInstruction as object with parts", () => {
      const request: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        systemInstruction: {
          parts: [{ text: "You are a helpful assistant." }],
        },
      };
      expect(request.systemInstruction?.parts).toHaveLength(1);
    });

    it("should support generationConfig", () => {
      const request: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1000,
          stopSequences: ["END"],
        },
      };
      expect(request.generationConfig?.temperature).toBe(0.7);
      expect(request.generationConfig?.maxOutputTokens).toBe(1000);
    });

    it("should support thinkingConfig", () => {
      const request: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: 8192,
            includeThoughts: true,
          },
        },
      };
      expect(request.generationConfig?.thinkingConfig?.thinkingBudget).toBe(
        8192
      );
    });

    it("should support tools with functionDeclarations", () => {
      const request: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_weather",
                description: "Get weather",
                parameters: {
                  type: "OBJECT",
                  properties: { location: { type: "STRING" } },
                  required: ["location"],
                },
              },
            ],
          },
        ],
      };
      expect(request.tools?.[0]!.functionDeclarations).toHaveLength(1);
    });

    it("should support toolConfig", () => {
      const request: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        toolConfig: {
          functionCallingConfig: {
            mode: "AUTO",
            allowedFunctionNames: ["get_weather"],
          },
        },
      };
      expect(request.toolConfig?.functionCallingConfig?.mode).toBe("AUTO");
    });
  });

  describe("GeminiContent", () => {
    it("should support user role", () => {
      const content: GeminiContent = {
        role: "user",
        parts: [{ text: "Hello" }],
      };
      expect(content.role).toBe("user");
    });

    it("should support model role", () => {
      const content: GeminiContent = {
        role: "model",
        parts: [{ text: "Hi there!" }],
      };
      expect(content.role).toBe("model");
    });
  });

  describe("GeminiPart", () => {
    it("should support text part", () => {
      const part: GeminiPart = { text: "Hello" };
      expect(part.text).toBe("Hello");
    });

    it("should support inlineData part", () => {
      const part: GeminiPart = {
        inlineData: { mimeType: "image/png", data: "base64data" },
      };
      expect(part.inlineData?.mimeType).toBe("image/png");
    });

    it("should support functionCall part", () => {
      const part: GeminiPart = {
        functionCall: { name: "get_weather", args: { location: "NYC" } },
      };
      expect(part.functionCall?.name).toBe("get_weather");
    });

    it("should support functionResponse part", () => {
      const part: GeminiPart = {
        functionResponse: { name: "get_weather", response: { temp: 72 } },
      };
      expect(part.functionResponse?.name).toBe("get_weather");
    });

    it("should support thinking part with thought flag", () => {
      const part: GeminiPart = {
        thought: true,
        text: "Let me think about this...",
        thoughtSignature: "sig123",
      };
      expect(part.thought).toBe(true);
      expect(part.thoughtSignature).toBe("sig123");
    });
  });

  describe("GeminiTool", () => {
    it("should support functionDeclarations", () => {
      const tool: GeminiTool = {
        functionDeclarations: [
          {
            name: "search",
            description: "Search the web",
            parameters: { type: "OBJECT", properties: {} },
          },
        ],
      };
      expect(tool.functionDeclarations?.[0]!.name).toBe("search");
    });

    it("should support built-in tools", () => {
      const tool: GeminiTool = { googleSearch: {} };
      expect(tool.googleSearch).toBeDefined();
    });
  });

  describe("GeminiResponse", () => {
    it("should have candidates", () => {
      const response: GeminiResponse = {
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
      };
      expect(response.candidates).toHaveLength(1);
      expect(response.candidates[0]!.finishReason).toBe("STOP");
    });

    it("should support thinking in response", () => {
      const response: GeminiResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { thought: true, text: "Thinking...", thoughtSignature: "sig" },
                { text: "Answer" },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 50,
          totalTokenCount: 60,
          thoughtsTokenCount: 30,
        },
      };
      expect(response.usageMetadata?.thoughtsTokenCount).toBe(30);
    });

    it("should support functionCall in response", () => {
      const response: GeminiResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "get_weather", args: {} } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      };
      expect(response.candidates[0]!.content.parts[0]!.functionCall?.name).toBe(
        "get_weather"
      );
    });
  });

  describe("GeminiStreamChunk", () => {
    it("should represent streaming response", () => {
      const chunk: GeminiStreamChunk = {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hel" }] },
            finishReason: undefined,
          },
        ],
      };
      expect(chunk.candidates[0]!.content.parts[0]!.text).toBe("Hel");
    });

    it("should support usage in final chunk", () => {
      const chunk: GeminiStreamChunk = {
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 50,
          totalTokenCount: 60,
        },
      };
      expect(chunk.usageMetadata?.totalTokenCount).toBe(60);
    });
  });

  describe("Type Guards", () => {
    describe("isGeminiRequest", () => {
      it("should return true for valid Gemini request", () => {
        const request = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        };
        expect(isGeminiRequest(request)).toBe(true);
      });

      it("should return false for missing contents", () => {
        const request = { generationConfig: {} };
        expect(isGeminiRequest(request)).toBe(false);
      });

      it("should return false for non-object", () => {
        expect(isGeminiRequest(null)).toBe(false);
        expect(isGeminiRequest("string")).toBe(false);
      });

      it("should distinguish from OpenAI format", () => {
        // OpenAI uses messages, not contents
        const openaiRequest = {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        };
        expect(isGeminiRequest(openaiRequest)).toBe(false);
      });
    });

    describe("isGeminiResponse", () => {
      it("should return true for valid Gemini response", () => {
        const response = {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hi" }] },
              finishReason: "STOP",
            },
          ],
        };
        expect(isGeminiResponse(response)).toBe(true);
      });

      it("should return false for missing candidates", () => {
        const response = { usageMetadata: {} };
        expect(isGeminiResponse(response)).toBe(false);
      });
    });

    describe("isGeminiContent", () => {
      it("should return true for valid content", () => {
        expect(isGeminiContent({ role: "user", parts: [] })).toBe(true);
        expect(
          isGeminiContent({ role: "model", parts: [{ text: "Hi" }] })
        ).toBe(true);
      });

      it("should return false for invalid role", () => {
        expect(isGeminiContent({ role: "assistant", parts: [] })).toBe(false);
      });

      it("should return false for missing parts", () => {
        expect(isGeminiContent({ role: "user" })).toBe(false);
      });
    });

    describe("isGeminiStreamChunk", () => {
      it("should return true for valid stream chunk", () => {
        const chunk = {
          candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }],
        };
        expect(isGeminiStreamChunk(chunk)).toBe(true);
      });

      it("should return false for non-chunk", () => {
        expect(isGeminiStreamChunk({ text: "Hello" })).toBe(false);
      });
    });
  });
});
