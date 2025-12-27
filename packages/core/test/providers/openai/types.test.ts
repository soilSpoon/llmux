import { describe, expect, it } from "bun:test";
import {
  type OpenAIRequest,
  type OpenAIResponse,
  type OpenAIMessage,
  type OpenAITool,
  type OpenAIStreamChunk,
  isOpenAIRequest,
  isOpenAIResponse,
  isOpenAIMessage,
  isOpenAIStreamChunk,
} from "../../../src/providers/openai/types";

describe("OpenAI Types", () => {
  describe("OpenAIRequest", () => {
    it("should have required model and messages fields", () => {
      const request: OpenAIRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      };
      expect(request.model).toBe("gpt-4");
      expect(request.messages).toHaveLength(1);
    });

    it("should support optional parameters", () => {
      const request: OpenAIRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 0.9,
        stop: ["END"],
        stream: true,
        tools: [],
        tool_choice: "auto",
      };
      expect(request.max_tokens).toBe(1000);
      expect(request.temperature).toBe(0.7);
      expect(request.stream).toBe(true);
    });

    it("should support reasoning_effort for o1/o3 models", () => {
      const request: OpenAIRequest = {
        model: "o1",
        messages: [{ role: "user", content: "Hello" }],
        reasoning_effort: "high",
      };
      expect(request.reasoning_effort).toBe("high");
    });
  });

  describe("OpenAIMessage", () => {
    it("should support system message", () => {
      const msg: OpenAIMessage = {
        role: "system",
        content: "You are a helpful assistant.",
      };
      expect(msg.role).toBe("system");
    });

    it("should support user message with string content", () => {
      const msg: OpenAIMessage = {
        role: "user",
        content: "Hello",
      };
      expect(msg.content).toBe("Hello");
    });

    it("should support user message with content parts array", () => {
      const msg: OpenAIMessage = {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image_url",
            image_url: { url: "https://example.com/image.jpg" },
          },
        ],
      };
      expect(Array.isArray(msg.content)).toBe(true);
    });

    it("should support assistant message with tool_calls", () => {
      const msg: OpenAIMessage = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "get_weather", arguments: '{"location":"NYC"}' },
          },
        ],
      };
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls![0]!.function.name).toBe("get_weather");
    });

    it("should support tool message with tool_call_id", () => {
      const msg: OpenAIMessage = {
        role: "tool",
        content: '{"temperature": 72}',
        tool_call_id: "call_123",
      };
      expect(msg.tool_call_id).toBe("call_123");
    });
  });

  describe("OpenAITool", () => {
    it("should define function with parameters", () => {
      const tool: OpenAITool = {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
            },
            required: ["location"],
          },
        },
      };
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBe("get_weather");
    });
  });

  describe("OpenAIResponse", () => {
    it("should have required fields", () => {
      const response: OpenAIResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1694268190,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
      };
      expect(response.id).toBe("chatcmpl-123");
      expect(response.choices).toHaveLength(1);
    });

    it("should support usage info", () => {
      const response: OpenAIResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1694268190,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };
      expect(response.usage?.total_tokens).toBe(30);
    });

    it("should support tool_calls in response", () => {
      const response: OpenAIResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1694268190,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc",
                  type: "function",
                  function: { name: "get_weather", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      expect(response.choices[0]!.finish_reason).toBe("tool_calls");
    });
  });

  describe("OpenAIStreamChunk", () => {
    it("should represent streaming delta", () => {
      const chunk: OpenAIStreamChunk = {
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
      };
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.choices[0]!.delta?.content).toBe("Hello");
    });
  });

  describe("Type Guards", () => {
    describe("isOpenAIRequest", () => {
      it("should return true for valid OpenAI request", () => {
        const request = {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        };
        expect(isOpenAIRequest(request)).toBe(true);
      });

      it("should return false for missing model", () => {
        const request = {
          messages: [{ role: "user", content: "Hello" }],
        };
        expect(isOpenAIRequest(request)).toBe(false);
      });

      it("should return false for missing messages", () => {
        const request = { model: "gpt-4" };
        expect(isOpenAIRequest(request)).toBe(false);
      });

      it("should return false for non-object", () => {
        expect(isOpenAIRequest(null)).toBe(false);
        expect(isOpenAIRequest("string")).toBe(false);
        expect(isOpenAIRequest(123)).toBe(false);
      });
    });

    describe("isOpenAIResponse", () => {
      it("should return true for valid OpenAI response", () => {
        const response = {
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello!" },
              finish_reason: "stop",
            },
          ],
        };
        expect(isOpenAIResponse(response)).toBe(true);
      });

      it("should return false for missing choices", () => {
        const response = {
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1694268190,
          model: "gpt-4",
        };
        expect(isOpenAIResponse(response)).toBe(false);
      });
    });

    describe("isOpenAIMessage", () => {
      it("should return true for valid message", () => {
        expect(isOpenAIMessage({ role: "user", content: "Hello" })).toBe(true);
        expect(isOpenAIMessage({ role: "assistant", content: null })).toBe(
          true
        );
      });

      it("should return false for invalid role", () => {
        expect(isOpenAIMessage({ role: "invalid", content: "Hello" })).toBe(
          false
        );
      });
    });

    describe("isOpenAIStreamChunk", () => {
      it("should return true for valid stream chunk", () => {
        const chunk = {
          id: "chatcmpl-123",
          object: "chat.completion.chunk",
          created: 1694268190,
          model: "gpt-4",
          choices: [
            { index: 0, delta: { content: "Hi" }, finish_reason: null },
          ],
        };
        expect(isOpenAIStreamChunk(chunk)).toBe(true);
      });

      it("should return false for non-chunk object", () => {
        const response = {
          id: "chatcmpl-123",
          object: "chat.completion",
          created: 1694268190,
          model: "gpt-4",
          choices: [],
        };
        expect(isOpenAIStreamChunk(response)).toBe(false);
      });
    });
  });
});
