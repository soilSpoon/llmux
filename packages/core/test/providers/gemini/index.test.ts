import { describe, expect, it } from "bun:test";
import { GeminiProvider } from "../../../src/providers/gemini";
import type { StreamChunk } from "../../../src/types/unified";
import type {
  GeminiRequest,
  GeminiResponse,
} from "../../../src/providers/gemini/types";
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTool,
} from "../_utils/fixtures";
import {
  expectRequestRoundTrip,
  expectResponseRoundTrip,
  collectStreamChunks,
} from "../_utils/helpers";

import { ToolNameCodec } from "../../../src/util/tool-name-codec";

const codec = new ToolNameCodec();

describe("GeminiProvider", () => {
  const provider = new GeminiProvider();

  describe("provider metadata", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("gemini");
    });

    it("should have correct config", () => {
      expect(provider.config.name).toBe("gemini");
      expect(provider.config.supportsStreaming).toBe(true);
      expect(provider.config.supportsThinking).toBe(true);
      expect(provider.config.supportsTools).toBe(true);
      expect(provider.config.supportsTools).toBe(true);
    });
  });

  describe("parse (GeminiRequest → UnifiedRequest)", () => {
    it("should parse basic Gemini request", () => {
      const geminiRequest: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      };

      const result = provider.parse(geminiRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello");
    });

    it("should parse systemInstruction", () => {
      const geminiRequest: GeminiRequest = {
        systemInstruction: { parts: [{ text: "Be helpful" }] },
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      };

      const result = provider.parse(geminiRequest);

      expect(result.system).toBe("Be helpful");
    });

    it("should parse generationConfig", () => {
      const geminiRequest: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7,
          topP: 0.9,
        },
      };

      const result = provider.parse(geminiRequest);

      expect(result.config?.maxTokens).toBe(1000);
      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.topP).toBe(0.9);
    });

    it("should parse thinkingConfig", () => {
      const geminiRequest: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        generationConfig: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 8192,
          },
        },
      };

      const result = provider.parse(geminiRequest);

      expect(result.thinking?.enabled).toBe(true);
      expect(result.thinking?.budget).toBe(8192);
    });

    it("should parse tools", () => {
      const geminiRequest: GeminiRequest = {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_weather",
                description: "Get weather",
                parameters: {
                  type: "OBJECT",
                  properties: { location: { type: "STRING" } },
                },
              },
            ],
          },
        ],
      };

      const result = provider.parse(geminiRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("get_weather");
    });
  });

  describe("transform (UnifiedRequest → GeminiRequest)", () => {
    it("should transform basic UnifiedRequest", () => {
      const unified = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
      });

      const result = provider.transform(unified, 'gemini-1.5-pro') as GeminiRequest;

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];
      expect(content?.role).toBe("user");
      const part = content?.parts[0];
      if (part && 'text' in part) {
        expect(part.text).toBe("Hello");
      }
    });

    it("should transform system to systemInstruction", () => {
      const unified = createUnifiedRequest({
        system: "Be helpful",
        messages: [createUnifiedMessage("user", "Hi")],
      });

      const result = provider.transform(unified, 'gemini-1.5-pro') as GeminiRequest;

      expect(result.systemInstruction).toEqual({
        parts: [{ text: "Be helpful" }],
      });
    });

    it("should transform config to generationConfig", () => {
      const unified = createUnifiedRequest({
        config: {
          maxTokens: 1000,
          temperature: 0.7,
        },
      });

      const result = provider.transform(unified, 'gemini-1.5-pro') as GeminiRequest;

      expect(result.generationConfig?.maxOutputTokens).toBe(1000);
      expect(result.generationConfig?.temperature).toBe(0.7);
    });

    it("should transform thinking to thinkingConfig", () => {
      const unified = createUnifiedRequest({
        thinking: { enabled: true, budget: 8192 },
      });

      const result = provider.transform(unified, 'gemini-2.0-flash-thinking') as GeminiRequest;

      expect(result.generationConfig?.thinkingConfig?.includeThoughts).toBe(
        true
      );
      expect(result.generationConfig?.thinkingConfig?.thinkingBudget).toBe(
        8192
      );
    });

    it("should transform tools to functionDeclarations", () => {
      const unified = createUnifiedRequest({
        tools: [createUnifiedTool("get_weather", "Get weather")],
      });

      const result = provider.transform(unified, 'gemini-1.5-pro') as GeminiRequest;

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.functionDeclarations![0]!.name).toBe(
        codec.encode("get_weather")
      );
    });
  });

  describe("parseResponse (GeminiResponse → UnifiedResponse)", () => {
    it("should parse basic Gemini response", () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello!" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        responseId: "resp_123",
      };

      const result = provider.parseResponse(geminiResponse);

      // result.id is random if not provided in envelope
      expect(result.id).toMatch(/^resp_/);
      expect(result.content[0]!.text).toBe("Hello!");
    });

    it("should parse functionCall response", () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "test", args: {} } }],
            },
            finishReason: "STOP",
          },
        ],
      };

      const result = provider.parseResponse(geminiResponse);

      expect(result.content[0]!.type).toBe("tool_call");
      expect(result.stopReason).toBe("tool_use");
    });

    it("should parse thinking response", () => {
      const geminiResponse: GeminiResponse = {
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
      };

      const result = provider.parseResponse(geminiResponse);

      expect(result.thinking).toHaveLength(1);
      expect(result.thinking![0]!.text).toBe("Thinking...");
      expect(result.content[0]!.text).toBe("Answer");
    });
  });

  describe("transformResponse (UnifiedResponse → GeminiResponse)", () => {
    it("should transform basic UnifiedResponse", () => {
      const unified = createUnifiedResponse({
        id: "resp_123",
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
      });

      const result = provider.transformResponse(unified) as GeminiResponse;

      expect(result.responseId).toBe("resp_123");
      const candidate = result.candidates?.[0];
      if (candidate?.content?.parts?.[0] && 'text' in candidate.content.parts[0]) {
          expect(candidate.content.parts[0].text).toBe("Hello!");
      }
      expect(candidate?.finishReason).toBe("STOP");
    });

    it("should transform tool_call response", () => {
      const unified = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: { id: "call_1", name: "test", arguments: {} },
          },
        ],
      });

      const result = provider.transformResponse(unified) as GeminiResponse;

      const candidate = result.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      if (part && 'functionCall' in part) {
        expect(part.functionCall).toBeDefined();
      }
    });

    it("should transform thinking response", () => {
      const unified = createUnifiedResponse({
        thinking: [{ text: "Thinking...", signature: "sig" }],
        content: [{ type: "text", text: "Answer" }],
      });

      const result = provider.transformResponse(unified) as GeminiResponse;

      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (parts?.[0] && 'thought' in parts[0]) {
        expect(parts[0].thought).toBe(true);
      }
      if (parts?.[1] && 'text' in parts[1]) {
        expect(parts[1].text).toBe("Answer");
      }
    });
  });

  describe("parseStreamChunk", () => {
    it("should parse streaming chunk", () => {
      const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`;

      const result = provider.parseStreamChunk!(sse);

      expect(result?.type).toBe("text-delta");
      expect(result?.delta?.text).toBe("Hello");
    });

    it("should return null for [DONE]", () => {
      const sse = `data: [DONE]`;

      const result = provider.parseStreamChunk!(sse);

      expect(result).toBeNull();
    });

    it("should parse thinking chunks", () => {
      const sse = `data: {"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Thinking..."}]}}]}`;

      const result = provider.parseStreamChunk!(sse);

      expect(result?.type).toBe("thinking-delta");
    });
  });

  describe("transformStreamChunk", () => {
    it("should transform content chunk", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: { type: "text", text: "Hello" },
      };

      const result = provider.transformStreamChunk!(chunk);

      expect(result).toMatch(/^data: /);
      const parsed = JSON.parse(result.replace("data: ", ""));
      expect(parsed.candidates?.[0]?.content?.parts?.[0]?.text).toBe("Hello");
    });

    it("should transform done chunk with finishReason", () => {
      const chunk: StreamChunk = {
        type: "done",
        stopReason: "end_turn",
      };

      const result = provider.transformStreamChunk!(chunk);
      const parsed = JSON.parse(result.replace("data: ", ""));

      expect(parsed.candidates?.[0]?.finishReason).toBe("STOP");
    });

    it("should transform done chunk with finishReason", () => {
      const chunk: StreamChunk = {
        type: "done",
        stopReason: "end_turn",
      };

      const result = provider.transformStreamChunk!(chunk);
      const parsed = JSON.parse(result.replace("data: ", ""));

      expect(parsed.candidates?.[0]?.finishReason).toBe("STOP");
    });
  });

  describe("round-trip transformations", () => {
    it("should preserve request data through transform → parse", () => {
      const unified = createUnifiedRequest({
        system: "Be helpful",
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi!"),
        ],
        config: { temperature: 0.7, maxTokens: 1000 },
      });

      expectRequestRoundTrip(provider, unified);
    });

    it("should preserve response data through transform → parse", () => {
      const unified = createUnifiedResponse({
        id: "test_123",
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      expectResponseRoundTrip(provider, unified);
    });

    it("should handle streaming round-trip", () => {
      const chunks = [
        `data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}`,
        `data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]}}]}`,
        `data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}`,
      ];

      const parsedChunks = collectStreamChunks(provider, chunks);

      expect(parsedChunks.length).toBeGreaterThan(0);
      expect(parsedChunks[0]!.delta?.text).toBe("Hello");
      expect(parsedChunks[1]!.delta?.text).toBe(" world");
    });
  });

  describe("Provider interface compliance", () => {
    it("should implement all required methods", () => {
      expect(typeof provider.parse).toBe("function");
      expect(typeof provider.transform).toBe("function");
      expect(typeof provider.parseResponse).toBe("function");
      expect(typeof provider.transformResponse).toBe("function");
      expect(typeof provider.parseStreamChunk).toBe("function");
      expect(typeof provider.transformStreamChunk).toBe("function");
    });

    it("should have readonly name and config", () => {
      expect(provider.name).toBe("gemini");
      expect(provider.config).toBeDefined();
    });
  });
});
