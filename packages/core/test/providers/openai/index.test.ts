import { describe, expect, it } from "bun:test";
import { OpenAIProvider } from "../../../src/providers/openai";
import type {
  OpenAIRequest,
  OpenAIResponse,
} from "../../../src/providers/openai/types";
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
} from "../_utils/fixtures";
import {
  expectRequestRoundTrip,
  expectResponseRoundTrip,
  collectStreamChunks,
  mergeStreamChunksToResponse,
} from "../_utils/helpers";

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider();

  describe("provider configuration", () => {
    it("has correct name", () => {
      expect(provider.name).toBe("openai");
    });

    it("has correct config", () => {
      expect(provider.config).toEqual({
        name: "openai",
        supportsStreaming: true,
        supportsThinking: true,
        supportsTools: true,
      });
    });
  });

  describe("parse", () => {
    it("parses OpenAI request to UnifiedRequest", () => {
      const openaiRequest: OpenAIRequest = {
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello!" },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = provider.parse(openaiRequest);

      expect(result.system).toBe("You are helpful.");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello!");
      expect(result.config?.temperature).toBe(0.7);
      expect(result.config?.maxTokens).toBe(1000);
    });

    it("throws on invalid request", () => {
      expect(() => provider.parse({})).toThrow();
      expect(() => provider.parse({ model: "gpt-4" })).toThrow();
      expect(() => provider.parse({ messages: [] })).toThrow();
    });
  });

  describe("transform", () => {
    it("transforms UnifiedRequest to OpenAI format", () => {
      const unified = createUnifiedRequest({
        system: "Be helpful",
        messages: [createUnifiedMessage("user", "Hi")],
        config: {
          maxTokens: 500,
          temperature: 0.5,
        },
      });

      const result = provider.transform(unified, 'gpt-4') as OpenAIRequest;

      expect(result.model).toBe("gpt-4");
      expect(result.messages).toHaveLength(2);
      if (!result.messages || result.messages.length < 2) throw new Error('Expected messages');
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "Be helpful",
      });
      expect(result.messages[1]).toEqual({
        role: "user",
        content: "Hi",
      });
      expect(result.max_tokens).toBe(500);
      expect(result.temperature).toBe(0.5);
    });

    it("uses custom model when provided", () => {
      const unified = createUnifiedRequest();

      const result = provider.transform(unified, "gpt-4o") as OpenAIRequest;

      expect(result.model).toBe("gpt-4o");
    });
  });

  describe("parseResponse", () => {
    it("parses OpenAI response to UnifiedResponse", () => {
      const openaiResponse: OpenAIResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1694268190,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello there!",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = provider.parseResponse(openaiResponse);

      expect(result.id).toBe("chatcmpl-123");
      expect(result.content[0]!.text).toBe("Hello there!");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
    });

    it("throws on invalid response", () => {
      expect(() => provider.parseResponse({})).toThrow();
      expect(() => provider.parseResponse({ id: "test" })).toThrow();
    });
  });

  describe("transformResponse", () => {
    it("transforms UnifiedResponse to OpenAI format", () => {
      const unified = createUnifiedResponse({
        id: "resp-123",
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
        model: "gpt-4",
      });

      const result = provider.transformResponse(unified) as OpenAIResponse;

      expect(result.id).toBe("resp-123");
      expect(result.object).toBe("chat.completion");
      expect(result.model).toBe("gpt-4");
      expect(result.choices[0]!.message.content).toBe("Hello!");
      expect(result.choices[0]!.finish_reason).toBe("stop");
    });
  });

  describe("parseStreamChunk", () => {
    it("parses SSE content chunk", () => {
      const chunk = `data: ${JSON.stringify({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1694268190,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: { content: "Hello" },
            finish_reason: null,
          },
        ],
      })}`;

      const result = provider.parseStreamChunk!(chunk);

      expect(result?.type).toBe("content");
      expect(result?.delta?.text).toBe("Hello");
    });

    it("parses [DONE] message", () => {
      const result = provider.parseStreamChunk!("data: [DONE]");

      expect(result?.type).toBe("done");
    });
  });

  describe("transformStreamChunk", () => {
    it("transforms content chunk to SSE format", () => {
      const result = provider.transformStreamChunk!({
        type: "content",
        delta: { type: "text", text: "Hi" },
      });

      expect(result).toMatch(/^data: /);
      expect(result).toContain("Hi");
    });
  });

  describe("round-trip transformations", () => {
    it("request round-trip preserves content", () => {
      const unified = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "What is 2+2?"),
          createUnifiedMessage("assistant", "The answer is 4."),
        ],
        config: {
          maxTokens: 100,
          temperature: 0.5,
        },
      });

      expectRequestRoundTrip(provider, unified);
    });

    it("response round-trip preserves content", () => {
      const unified = createUnifiedResponse({
        id: "test-resp",
        content: [{ type: "text", text: "This is the answer." }],
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      });

      expectResponseRoundTrip(provider, unified);
    });
  });

  describe("streaming integration", () => {
    it("parses and merges stream chunks into response", () => {
      const chunks = [
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            { index: 0, delta: { content: "Hello" }, finish_reason: null },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            { index: 0, delta: { content: " world" }, finish_reason: null },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}`,
      ];

      const parsedChunks = collectStreamChunks(provider, chunks);
      const response = mergeStreamChunksToResponse(parsedChunks);

      expect(response.content[0]!.text).toBe("Hello world");
      expect(response.stopReason).toBe("end_turn");
    });

    it("handles tool call streaming", () => {
      const chunks = [
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_abc",
                    type: "function",
                    function: { name: "get_weather", arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"loc' } }],
              },
              finish_reason: null,
            },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        })}`,
      ];

      const parsedChunks = collectStreamChunks(provider, chunks);

      expect(parsedChunks.some((c) => c.type === "tool_call")).toBe(true);
      expect(
        parsedChunks.some(
          (c) => c.type === "done" && c.stopReason === "tool_use"
        )
      ).toBe(true);
    });
  });
});
