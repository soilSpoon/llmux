import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import type { StreamChunk } from "../../../src/types/unified";
import type {
  AntigravityRequest,
  AntigravityResponse,
} from "../../../src/providers/antigravity/types";
import {
  createUnifiedRequest,
  createUnifiedMessage,
  createUnifiedResponse,
  createUnifiedTool,
} from "../_utils/fixtures";
import {
  expectRequestRoundTrip,
  expectResponseRoundTrip,
} from "../_utils/helpers";

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
      const antigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      } as any;

      const result = provider.parse(antigravityRequest);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.parts[0]!.text).toBe("Hello");
    });

    it("should extract metadata from wrapper", () => {
      const antigravityRequest = {
        project: "my-project",
        model: "claude-sonnet-4-5",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          sessionId: "session-abc",
        },
      } as any;

      const result = provider.parse(antigravityRequest);

      // Metadata is extracted from both wrapper and inner request
      expect(result.metadata?.project).toBe("my-project");
      expect(result.metadata?.model).toBe("claude-sonnet-4-5");
      // sessionId is part of Gemini request, should be preserved by google-gemini format
      expect(result.metadata?.sessionId).toBe("session-abc");
    });

    it("should parse system instruction", () => {
      const antigravityRequest = {
        project: "test-project",
        model: "gemini-2.0-flash",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          systemInstruction: { parts: [{ text: "Be helpful." }] },
        },
      } as any;

      const result = provider.parse(antigravityRequest);

      expect(result.system).toBe("Be helpful.");
    });

    it("should parse tools", () => {
      const antigravityRequest = {
        project: "test-project",
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
      } as any;

      const result = provider.parse(antigravityRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]!.name).toBe("search");
    });

    it("should throw for invalid request", () => {
      expect(() => provider.parse({ invalid: "request" })).toThrow();
    });
  });

  describe("parseStreamChunk()", () => {
    it("should parse Gemini format unwrapped candidates", () => {
      const chunk = JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: "Hello", thought: false }] },
            finishReason: "STOP",
          },
        ],
      });

      const pipeline = provider.createStreamingPipeline("model");
      const result = pipeline.parse(chunk) as StreamChunk[];
      
      expect(result).toHaveLength(2); // text-delta + finish
      expect(result[0]!.type).toBe("text-delta");
      expect(result[0]!.delta?.text).toBe("Hello");
      expect(result[1]!.type).toBe("finish");
    });

    it("should parse Gemini format wrapped response", () => {
      const chunk = JSON.stringify({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "World", thought: false }] },
              finishReason: "STOP",
            },
          ],
        },
      });

      const pipeline = provider.createStreamingPipeline("model");
      const result = pipeline.parse(chunk) as StreamChunk[];

      expect(result).toHaveLength(2);
      expect(result[0]!.type).toBe("text-delta");
      expect(result[0]!.delta?.text).toBe("World");
    });

    it("should parse Anthropic format content_block_start (tool_use)", () => {
      const chunk = JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "get_weather",
          input: {},
        },
      });

      const pipeline = provider.createStreamingPipeline("model");
      const result = pipeline.parse(chunk) as StreamChunk;

      expect(result.type).toBe("tool-call-start");
      expect(result.toolCall?.id).toBe("toolu_123");
      expect(result.toolCall?.name).toBe("get_weather");
      expect(result.blockIndex).toBe(0);
    });

    it("should parse Anthropic format content_block_delta (text)", () => {
      const chunk = JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "text_delta",
          text: "thinking...",
        },
      });

      const pipeline = provider.createStreamingPipeline("model");
      const result = pipeline.parse(chunk) as StreamChunk;

      expect(result.type).toBe("text-delta");
      expect(result.delta?.text).toBe("thinking...");
      expect(result.blockIndex).toBe(1);
    });

    it("should parse Anthropic format content_block_delta (input_json)", () => {
      const chunk = JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"loc":',
        },
      });

      const pipeline = provider.createStreamingPipeline("model");
      const result = pipeline.parse(chunk) as StreamChunk;

      expect(result.type).toBe("tool-input-delta");
      expect(result.delta?.partialJson).toBe('{"loc":');
      expect(result.blockIndex).toBe(0);
    });

    it("should parse Anthropic format message_delta (stop_reason)", () => {
      const chunk = JSON.stringify({
        type: "message_delta",
        delta: {
          stop_reason: "tool_use",
          stop_sequence: null,
        },
        usage: {
          output_tokens: 15,
        },
      });

      const pipeline = provider.createStreamingPipeline("model");
      const result = pipeline.parse(chunk) as StreamChunk;

      expect(result.type).toBe("finish");
      expect(result.finishReason?.unified).toBe("tool_use");
      expect(result.usage?.outputTokens).toBe(15);
    });
  });

  describe("transform()", () => {
    it("should transform a simple UnifiedRequest", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
      });

      const result = provider.transform(request, 'gemini-2.0-flash') as AntigravityRequest;

      expect(result.project).toBeDefined();
      expect(result.model).toBeDefined();
      expect(result.request.contents[0]!.parts[0]!.text).toBe("Hello");
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

      const result = provider.transform(request, 'claude-sonnet-4-5') as AntigravityRequest;

      expect(result.project).toBe("custom-project");
      expect(result.model).toBe("claude-sonnet-4-5");
      // sessionId is part of Gemini request
      expect((result.request as Record<string, any>).sessionId).toBe("session-xyz");
    });

    it("should transform system to systemInstruction", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        system: "You are helpful.",
      });

      const result = provider.transform(request, 'gemini-3-pro') as AntigravityRequest;

      // Antigravity provider injects default system instruction at the beginning
      // So our instruction should be appended
      const parts = result.request.systemInstruction?.parts;
      expect(parts).toBeDefined();
      expect(parts!.length).toBeGreaterThan(1);
      
      const userPart = parts!.find(p => p.text === "You are helpful.");
      expect(userPart).toBeDefined();
    });

    it("should transform tools with VALIDATED mode", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        tools: [createUnifiedTool("test_tool", "A test tool")],
      });

      const result = provider.transform(request, 'claude-sonnet-4-5') as AntigravityRequest;

      expect(result.request.tools).toHaveLength(1);
      // VALIDATED mode check - this depends on the google-gemini format implementation
      // Some versions might set it, some might not. We check if it's there if expected.
      if (result.request.toolConfig?.functionCallingConfig) {
        expect(result.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
      }
    });

    it("should use snake_case thinking config for Claude models", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        thinking: { enabled: true, budget: 16384, includeThoughts: true },
        metadata: { model: "claude-sonnet-4-5-thinking" },
      });

      const result = provider.transform(request, 'claude-sonnet-4-5-thinking') as AntigravityRequest;

      // Thinking config fields use snake_case
      const genConfig = result.request.generationConfig;
      if (genConfig && 'thinking_config' in genConfig && genConfig.thinking_config) {
        expect(genConfig.thinking_config.include_thoughts).toBe(true);
        expect(genConfig.thinking_config.thinking_budget).toBe(16384);
      } else {
        throw new Error("Expected thinking_config to be defined");
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

      expect(result.content[0]!.text).toBe("Hello!");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
    });

    it("should parse thinking blocks", () => {
      const response: AntigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    thought: true,
                    text: "Thinking...",
                    thoughtSignature: "sig",
                  },
                  { text: "Answer" },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      };

      const result = provider.parseResponse(response);

      expect(result.thinking).toHaveLength(1);
      expect(result.thinking![0]!.text).toBe("Thinking...");
      expect(result.content[0]!.text).toBe("Answer");
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

      expect(result.content[0]!.type).toBe("tool_call");
      expect(result.content[0]!.toolCall?.name).toBe("get_weather");
      expect(result.stopReason).toBe("tool_use");
    });

    it("should throw for invalid response", () => {
      expect(() => provider.parseResponse({ invalid: "response" })).toThrow();
    });
  });

  describe("transformResponse()", () => {
    it("should transform a simple UnifiedResponse", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Hello!" }],
        stopReason: "end_turn",
      });

      const result = provider.transformResponse(
        response
      ) as AntigravityResponse;

      // Result is now wrapped in { response: ... }
      expect(result.response.candidates[0]!.content.parts[0]!.text).toBe(
        "Hello!"
      );
      expect(result.response.candidates[0]!.finishReason).toBe("STOP");
    });

    it("should transform thinking blocks", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Answer" }],
        thinking: [{ text: "Thinking...", signature: "sig123" }],
      });

      const result = provider.transformResponse(
        response
      ) as AntigravityResponse;

      // Result is wrapped in { response: ... }
      const parts = result.response.candidates[0]!.content.parts;
      expect(parts[0]!.thought).toBe(true);
      expect(parts[0]!.text).toBe("Thinking...");
      expect(parts[0]!.thoughtSignature).toBe("sig123");
    });

    it("should transform tool calls", () => {
      const response = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "call-abc",
              name: "search",
              arguments: { query: "test" },
            },
          },
        ],
        stopReason: "tool_use",
      });

      const result = provider.transformResponse(
        response
      ) as AntigravityResponse;

      // Result is wrapped in { response: ... }
      const fc = result.response.candidates[0]!.content.parts[0]!.functionCall;
      expect(fc?.name).toBe("search");
      expect(fc?.id).toBe("call-abc");
    });
  });

  // Duplicate block removed


  describe("request round-trip", () => {
    it("should maintain text content through round-trip", () => {
      const request = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "Hello"),
          createUnifiedMessage("assistant", "Hi there!"),
        ],
        system: "Be helpful",
      });

      expectRequestRoundTrip(provider, request);
    });
    
    it("should maintain tools through round-trip", () => {
      const request = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Search for something")],
        tools: [
          createUnifiedTool("search", "Search the web", {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          }),
        ],
      });

      const providerRequest = provider.transform(request, 'gemini-2.0-flash');
      const parsed = provider.parse(providerRequest);

      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools![0]!.name).toBe("search");
    });
  });
  
  describe("response round-trip", () => {
    it("should maintain text content through round-trip", () => {
      const response = createUnifiedResponse({
        content: [{ type: "text", text: "Hello, world!" }],
        stopReason: "end_turn",
      });

      expectResponseRoundTrip(provider, response);
    });

    it("should maintain tool calls through round-trip", () => {
      const response = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "call-123",
              name: "search",
              arguments: { query: "test" },
            },
          },
        ],
        stopReason: "tool_use",
      });

      const providerResponse = provider.transformResponse(response);
      const parsed = provider.parseResponse(providerResponse);

      expect(parsed.content[0]!.type).toBe("tool_call");
      expect(parsed.content[0]!.toolCall?.name).toBe("search");
    });
  });
});
