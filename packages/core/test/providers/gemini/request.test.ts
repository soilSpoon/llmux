import { describe, expect, it } from "bun:test";
import { parse, transform } from "../../../src/providers/gemini/request";
import type { GeminiRequest } from "../../../src/providers/gemini/types";
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedTool,
  createUnifiedToolCall,
} from "../_utils/fixtures";

describe("Gemini Request Transformations", () => {
  describe("transform (UnifiedRequest → GeminiRequest)", () => {
    describe("basic messages", () => {
      it("should transform a simple user message", () => {
        const unified = createUnifiedRequest({
          messages: [createUnifiedMessage("user", "Hello")],
        });

        const result = transform(unified);

        expect(result.contents).toHaveLength(1);
        expect(result.contents[0]!.role).toBe("user");
        expect(result.contents[0]!.parts).toHaveLength(1);
        expect(result.contents[0]!.parts[0]!.text).toBe("Hello");
      });

      it("should map assistant role to model role", () => {
        const unified = createUnifiedRequest({
          messages: [
            createUnifiedMessage("user", "Hello"),
            createUnifiedMessage("assistant", "Hi there!"),
          ],
        });

        const result = transform(unified);

        expect(result.contents).toHaveLength(2);
        expect(result.contents[0]!.role).toBe("user");
        expect(result.contents[1]!.role).toBe("model");
      });

      it("should handle multi-turn conversation", () => {
        const unified = createUnifiedRequest({
          messages: [
            createUnifiedMessage("user", "What is 2+2?"),
            createUnifiedMessage("assistant", "The answer is 4."),
            createUnifiedMessage("user", "Thanks!"),
          ],
        });

        const result = transform(unified);

        expect(result.contents).toHaveLength(3);
        expect(result.contents[0]!.role).toBe("user");
        expect(result.contents[1]!.role).toBe("model");
        expect(result.contents[2]!.role).toBe("user");
      });
    });

    describe("system instruction", () => {
      it("should transform system to systemInstruction object with parts", () => {
        const unified = createUnifiedRequest({
          system: "You are a helpful assistant.",
          messages: [createUnifiedMessage("user", "Hello")],
        });

        const result = transform(unified);

        expect(result.systemInstruction).toBeDefined();
        expect(result.systemInstruction!.parts).toHaveLength(1);
        expect(result.systemInstruction!.parts[0]!.text).toBe(
          "You are a helpful assistant."
        );
      });

      it("should NOT include systemInstruction if system is undefined", () => {
        const unified = createUnifiedRequest({
          messages: [createUnifiedMessage("user", "Hello")],
        });

        const result = transform(unified);

        expect(result.systemInstruction).toBeUndefined();
      });
    });

    describe("generation config", () => {
      it("should transform maxTokens to maxOutputTokens", () => {
        const unified = createUnifiedRequest({
          config: { maxTokens: 500 },
        });

        const result = transform(unified);

        expect(result.generationConfig?.maxOutputTokens).toBe(500);
      });

      it("should transform temperature", () => {
        const unified = createUnifiedRequest({
          config: { temperature: 0.7 },
        });

        const result = transform(unified);

        expect(result.generationConfig?.temperature).toBe(0.7);
      });

      it("should transform topP", () => {
        const unified = createUnifiedRequest({
          config: { topP: 0.9 },
        });

        const result = transform(unified);

        expect(result.generationConfig?.topP).toBe(0.9);
      });

      it("should transform topK", () => {
        const unified = createUnifiedRequest({
          config: { topK: 40 },
        });

        const result = transform(unified);

        expect(result.generationConfig?.topK).toBe(40);
      });

      it("should transform stopSequences", () => {
        const unified = createUnifiedRequest({
          config: { stopSequences: ["END", "STOP"] },
        });

        const result = transform(unified);

        expect(result.generationConfig?.stopSequences).toEqual(["END", "STOP"]);
      });

      it("should transform all config options together", () => {
        const unified = createUnifiedRequest({
          config: {
            maxTokens: 1000,
            temperature: 0.5,
            topP: 0.8,
            topK: 30,
            stopSequences: ["END"],
          },
        });

        const result = transform(unified);

        expect(result.generationConfig).toEqual({
          maxOutputTokens: 1000,
          temperature: 0.5,
          topP: 0.8,
          topK: 30,
          stopSequences: ["END"],
        });
      });
    });

    describe("thinking config", () => {
      it("should transform thinking.enabled to thinkingConfig.includeThoughts", () => {
        const unified = createUnifiedRequest({
          thinking: { enabled: true },
        });

        const result = transform(unified);

        expect(result.generationConfig?.thinkingConfig?.includeThoughts).toBe(
          true
        );
      });

      it("should transform thinking.budget to thinkingConfig.thinkingBudget", () => {
        const unified = createUnifiedRequest({
          thinking: { enabled: true, budget: 8192 },
        });

        const result = transform(unified);

        expect(result.generationConfig?.thinkingConfig?.includeThoughts).toBe(
          true
        );
        expect(result.generationConfig?.thinkingConfig?.thinkingBudget).toBe(
          8192
        );
      });

      it("should NOT include thinkingConfig if thinking is disabled", () => {
        const unified = createUnifiedRequest({
          thinking: { enabled: false },
        });

        const result = transform(unified);

        expect(result.generationConfig?.thinkingConfig).toBeUndefined();
      });
    });

    describe("tools", () => {
      it("should transform tools to functionDeclarations", () => {
        const unified = createUnifiedRequest({
          tools: [
            createUnifiedTool("get_weather", "Get weather", {
              type: "object",
              properties: {
                location: { type: "string", description: "City name" },
              },
              required: ["location"],
            }),
          ],
        });

        const result = transform(unified);

        expect(result.tools).toHaveLength(1);
        expect(result.tools![0]!.functionDeclarations).toHaveLength(1);
        expect(result.tools![0]!.functionDeclarations![0]!.name).toBe(
          "get_weather"
        );
        expect(result.tools![0]!.functionDeclarations![0]!.description).toBe(
          "Get weather"
        );
      });

      it("should convert schema types to UPPERCASE", () => {
        const unified = createUnifiedRequest({
          tools: [
            createUnifiedTool("test_tool", "Test", {
              type: "object",
              properties: {
                name: { type: "string" },
                count: { type: "integer" },
                price: { type: "number" },
                active: { type: "boolean" },
                items: { type: "array", items: { type: "string" } },
              },
            }),
          ],
        });

        const result = transform(unified);

        const params = result.tools![0]!.functionDeclarations![0]!.parameters;
        expect(params?.type).toBe("OBJECT");
        expect(params?.properties?.name?.type).toBe("STRING");
        expect(params?.properties?.count?.type).toBe("INTEGER");
        expect(params?.properties?.price?.type).toBe("NUMBER");
        expect(params?.properties?.active?.type).toBe("BOOLEAN");
        expect(params?.properties?.items?.type).toBe("ARRAY");
      });

      it("should handle multiple tools", () => {
        const unified = createUnifiedRequest({
          tools: [
            createUnifiedTool("tool1", "Tool 1"),
            createUnifiedTool("tool2", "Tool 2"),
          ],
        });

        const result = transform(unified);

        expect(result.tools).toHaveLength(1);
        expect(result.tools![0]!.functionDeclarations).toHaveLength(2);
      });
    });

    describe("content parts", () => {
      it("should transform image parts to inlineData", () => {
        const unified = createUnifiedRequest({
          messages: [
            {
              role: "user",
              parts: [
                { type: "text", text: "What is this?" },
                {
                  type: "image",
                  image: { mimeType: "image/png", data: "base64data" },
                },
              ],
            },
          ],
        });

        const result = transform(unified);

        expect(result.contents[0]!.parts).toHaveLength(2);
        expect(result.contents[0]!.parts[0]!.text).toBe("What is this?");
        expect(result.contents[0]!.parts[1]!.inlineData).toEqual({
          mimeType: "image/png",
          data: "base64data",
        });
      });

      it("should transform tool_call parts to functionCall in model content", () => {
        const toolCall = createUnifiedToolCall(
          "get_weather",
          { location: "NYC" },
          "call_123"
        );
        const unified = createUnifiedRequest({
          messages: [
            createUnifiedMessage("user", "What is the weather?"),
            {
              role: "assistant",
              parts: [{ type: "tool_call", toolCall }],
            },
          ],
        });

        const result = transform(unified);

        expect(result.contents[1]!.role).toBe("model");
        expect(result.contents[1]!.parts[0]!.functionCall).toEqual({
          name: "get_weather",
          args: { location: "NYC" },
        });
      });

      it("should transform tool_result parts to functionResponse in user content", () => {
        const unified = createUnifiedRequest({
          messages: [
            {
              role: "user",
              parts: [
                {
                  type: "tool_result",
                  toolResult: {
                    toolCallId: "call_123",
                    content: '{"temperature": 72}',
                  },
                },
              ],
            },
          ],
        });

        const result = transform(unified);

        expect(result.contents[0]!.role).toBe("user");
        expect(result.contents[0]!.parts[0]!.functionResponse).toBeDefined();
        expect(result.contents[0]!.parts[0]!.functionResponse!.name).toBe(
          "call_123"
        );
      });

      it("should transform tool role messages to user with functionResponse", () => {
        const unified = createUnifiedRequest({
          messages: [
            {
              role: "tool",
              parts: [
                {
                  type: "tool_result",
                  toolResult: {
                    toolCallId: "get_weather",
                    content: '{"temp": 72}',
                  },
                },
              ],
            },
          ],
        });

        const result = transform(unified);

        expect(result.contents[0]!.role).toBe("user");
        expect(result.contents[0]!.parts[0]!.functionResponse).toBeDefined();
      });
    });
  });

  describe("parse (GeminiRequest → UnifiedRequest)", () => {
    describe("basic messages", () => {
      it("should parse a simple user message", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        };

        const result = parse(gemini);

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.role).toBe("user");
        expect(result.messages[0]!.parts[0]!.text).toBe("Hello");
      });

      it("should map model role to assistant role", () => {
        const gemini: GeminiRequest = {
          contents: [
            { role: "user", parts: [{ text: "Hello" }] },
            { role: "model", parts: [{ text: "Hi!" }] },
          ],
        };

        const result = parse(gemini);

        expect(result.messages[1]!.role).toBe("assistant");
      });
    });

    describe("system instruction", () => {
      it("should parse systemInstruction.parts[0]!.text to system", () => {
        const gemini: GeminiRequest = {
          systemInstruction: {
            parts: [{ text: "You are helpful." }],
          },
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        };

        const result = parse(gemini);

        expect(result.system).toBe("You are helpful.");
      });

      it("should handle missing systemInstruction", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        };

        const result = parse(gemini);

        expect(result.system).toBeUndefined();
      });
    });

    describe("generation config", () => {
      it("should parse maxOutputTokens to maxTokens", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: { maxOutputTokens: 500 },
        };

        const result = parse(gemini);

        expect(result.config?.maxTokens).toBe(500);
      });

      it("should parse all generation config options", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            stopSequences: ["END"],
          },
        };

        const result = parse(gemini);

        expect(result.config).toEqual({
          maxTokens: 1000,
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          stopSequences: ["END"],
        });
      });
    });

    describe("thinking config", () => {
      it("should parse thinkingConfig.includeThoughts to thinking.enabled", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            thinkingConfig: { includeThoughts: true },
          },
        };

        const result = parse(gemini);

        expect(result.thinking?.enabled).toBe(true);
      });

      it("should parse thinkingConfig.thinkingBudget to thinking.budget", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: 8192,
            },
          },
        };

        const result = parse(gemini);

        expect(result.thinking?.enabled).toBe(true);
        expect(result.thinking?.budget).toBe(8192);
      });
    });

    describe("tools", () => {
      it("should parse functionDeclarations to tools", () => {
        const gemini: GeminiRequest = {
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

        const result = parse(gemini);

        expect(result.tools).toHaveLength(1);
        expect(result.tools![0]!.name).toBe("get_weather");
        expect(result.tools![0]!.description).toBe("Get weather");
      });

      it("should convert schema types to lowercase", () => {
        const gemini: GeminiRequest = {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          tools: [
            {
              functionDeclarations: [
                {
                  name: "test",
                  parameters: {
                    type: "OBJECT",
                    properties: {
                      str: { type: "STRING" },
                      num: { type: "NUMBER" },
                      int: { type: "INTEGER" },
                      bool: { type: "BOOLEAN" },
                      arr: { type: "ARRAY" },
                    },
                  },
                },
              ],
            },
          ],
        };

        const result = parse(gemini);

        const params = result.tools![0]!.parameters;
        expect(params.type).toBe("object");
        expect(params.properties?.str?.type).toBe("string");
        expect(params.properties?.num?.type).toBe("number");
        expect(params.properties?.int?.type).toBe("integer");
        expect(params.properties?.bool?.type).toBe("boolean");
        expect(params.properties?.arr?.type).toBe("array");
      });
    });

    describe("content parts", () => {
      it("should parse inlineData to image parts", () => {
        const gemini: GeminiRequest = {
          contents: [
            {
              role: "user",
              parts: [
                { text: "What is this?" },
                { inlineData: { mimeType: "image/png", data: "base64data" } },
              ],
            },
          ],
        };

        const result = parse(gemini);

        expect(result.messages[0]!.parts).toHaveLength(2);
        expect(result.messages[0]!.parts[0]!.type).toBe("text");
        expect(result.messages[0]!.parts[1]!.type).toBe("image");
        expect(result.messages[0]!.parts[1]!.image).toEqual({
          mimeType: "image/png",
          data: "base64data",
        });
      });

      it("should parse functionCall to tool_call parts", () => {
        const gemini: GeminiRequest = {
          contents: [
            { role: "user", parts: [{ text: "Weather?" }] },
            {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "get_weather",
                    args: { location: "NYC" },
                  },
                },
              ],
            },
          ],
        };

        const result = parse(gemini);

        expect(result.messages[1]!.parts[0]!.type).toBe("tool_call");
        expect(result.messages[1]!.parts[0]!.toolCall?.name).toBe(
          "get_weather"
        );
        expect(result.messages[1]!.parts[0]!.toolCall?.arguments).toEqual({
          location: "NYC",
        });
      });

      it("should parse functionResponse to tool_result parts", () => {
        const gemini: GeminiRequest = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    name: "get_weather",
                    response: { temperature: 72 },
                  },
                },
              ],
            },
          ],
        };

        const result = parse(gemini);

        expect(result.messages[0]!.parts[0]!.type).toBe("tool_result");
        expect(result.messages[0]!.parts[0]!.toolResult?.toolCallId).toBe(
          "get_weather"
        );
      });
    });
  });

  describe("round-trip transformations", () => {
    it("should preserve data through transform → parse", () => {
      const original = createUnifiedRequest({
        system: "Be helpful",
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi!"),
        ],
        config: {
          temperature: 0.7,
          maxTokens: 1000,
        },
      });

      const gemini = transform(original);
      const result = parse(gemini);

      expect(result.system).toBe(original.system);
      expect(result.messages).toHaveLength(original.messages.length);
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello");
      expect(result.messages[1]!.parts[0]!.text).toBe("Hi!");
      expect(result.config?.temperature).toBe(original.config?.temperature);
      expect(result.config?.maxTokens).toBe(original.config?.maxTokens);
    });

    it("should preserve tools through round-trip", () => {
      const original = createUnifiedRequest({
        tools: [
          createUnifiedTool("get_weather", "Get weather", {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          }),
        ],
      });

      const gemini = transform(original);
      const result = parse(gemini);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("get_weather");
      expect(result.tools![0]!.parameters.type).toBe("object");
    });
  });
});
