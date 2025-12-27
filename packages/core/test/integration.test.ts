/**
 * Integration Tests - 12 Provider Transformation Combinations
 *
 * Tests:
 * 1. Request transformation for all 12 combinations
 * 2. Response transformation for all 12 combinations
 * 3. Round-trip transformation (A → B → A)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { transformRequest, transformResponse } from "../src/transform";
import {
  getProvider,
  registerProvider,
  clearProviders,
  type ProviderName,
} from "../src/providers";
import { OpenAIProvider } from "../src/providers/openai";
import { AnthropicProvider } from "../src/providers/anthropic";
import { GeminiProvider } from "../src/providers/gemini";
import { AntigravityProvider } from "../src/providers/antigravity";
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
} from "./providers/_utils/fixtures";

beforeEach(() => {
  clearProviders();
  registerProvider(new OpenAIProvider());
  registerProvider(new AnthropicProvider());
  registerProvider(new GeminiProvider());
  registerProvider(new AntigravityProvider());
});

const providerCombinations: Array<{ from: ProviderName; to: ProviderName }> = [
  { from: "openai", to: "anthropic" },
  { from: "openai", to: "gemini" },
  { from: "openai", to: "antigravity" },

  { from: "anthropic", to: "openai" },
  { from: "anthropic", to: "gemini" },
  { from: "anthropic", to: "antigravity" },

  { from: "gemini", to: "openai" },
  { from: "gemini", to: "anthropic" },
  { from: "gemini", to: "antigravity" },

  { from: "antigravity", to: "openai" },
  { from: "antigravity", to: "anthropic" },
  { from: "antigravity", to: "gemini" },
];

describe("Integration: Request Transformation", () => {
  describe.each(providerCombinations)("$from → $to", ({ from, to }) => {
    it("should transform request without errors", () => {
      const sourceProvider = getProvider(from);
      const unifiedRequest = createUnifiedRequest();

      const sourceRequest = sourceProvider.transform(unifiedRequest);
      const targetRequest = transformRequest(sourceRequest, { from, to });

      const targetProvider = getProvider(to);
      const parsedUnified = targetProvider.parse(targetRequest);

      expect(parsedUnified.messages).toHaveLength(
        unifiedRequest.messages.length
      );
      expect(parsedUnified.messages[0]!.role).toBe(
        unifiedRequest.messages[0]!.role
      );
    });

    it("should handle tool definitions", () => {
      const sourceProvider = getProvider(from);
      const requestWithTools = createUnifiedRequest({
        tools: [
          {
            name: "get_weather",
            description: "Get weather information",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
            },
          },
        ],
      });

      const sourceRequest = sourceProvider.transform(requestWithTools);
      const targetRequest = transformRequest(sourceRequest, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parse(targetRequest);

      expect(parsed.tools).toBeDefined();
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools![0]!.name).toBe("get_weather");
    });

    it("should handle tool calls", () => {
      const sourceProvider = getProvider(from);
      const requestWithToolCall = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "What is weather?"),
          createUnifiedMessage("assistant", ""),
          {
            role: "assistant",
            parts: [
              {
                type: "tool_call",
                toolCall: {
                  id: "call_123",
                  name: "get_weather",
                  arguments: { location: "Seoul" },
                },
              },
            ],
          },
        ],
      });

      const sourceRequest = sourceProvider.transform(requestWithToolCall);
      const targetRequest = transformRequest(sourceRequest, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parse(targetRequest);

      const toolCallMessage = parsed.messages[2];
      expect(toolCallMessage!.role).toBe("assistant");
      expect(toolCallMessage!.parts[0]!.type).toBe("tool_call");
    });
  });
});

describe("Integration: Response Transformation", () => {
  describe.each(providerCombinations)("$from → $to", ({ from, to }) => {
    it("should transform text response without errors", () => {
      const sourceProvider = getProvider(from);
      const unifiedResponse = createUnifiedResponse({
        content: [{ type: "text", text: "Hello, world!" }],
      });

      const sourceResponse = sourceProvider.transformResponse(unifiedResponse);
      const targetResponse = transformResponse(sourceResponse, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parseResponse(targetResponse);

      expect(parsed.content).toHaveLength(1);
      expect(parsed.content[0]!.type).toBe("text");
    });

    it("should handle tool call response", () => {
      const sourceProvider = getProvider(from);
      const responseWithToolCall = createUnifiedResponse({
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "call_456",
              name: "get_weather",
              arguments: { location: "Tokyo" },
            },
          },
        ],
      });

      const sourceResponse =
        sourceProvider.transformResponse(responseWithToolCall);
      const targetResponse = transformResponse(sourceResponse, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parseResponse(targetResponse);

      expect(parsed.content[0]!.type).toBe("tool_call");
      expect(parsed.content[0]!.toolCall?.name).toBe("get_weather");
    });

    it("should handle stop reasons", () => {
      const sourceProvider = getProvider(from);
      const unifiedResponse = createUnifiedResponse({
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
      });

      const sourceResponse = sourceProvider.transformResponse(unifiedResponse);
      const targetResponse = transformResponse(sourceResponse, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parseResponse(targetResponse);

      expect(parsed.stopReason).toBe("end_turn");
    });
  });
});

describe("Integration: Round-trip Transformation", () => {
  describe.each(providerCombinations)("$from → $to → $from", ({ from, to }) => {
    it("should preserve request data in round-trip", () => {
      const sourceProvider = getProvider(from);
      const unifiedRequest = createUnifiedRequest({
        messages: [
          createUnifiedMessage("user", "Test message"),
          createUnifiedMessage("assistant", "Test response"),
        ],
        tools: [
          {
            name: "test_tool",
            description: "A test tool",
            parameters: { type: "object", properties: {} },
          },
        ],
      });

      const sourceRequest = sourceProvider.transform(unifiedRequest);
      const targetRequest = transformRequest(sourceRequest, { from, to });
      const backToSourceRequest = transformRequest(targetRequest, {
        from: to,
        to: from,
      });

      const parsed = sourceProvider.parse(backToSourceRequest);

      expect(parsed.messages).toHaveLength(unifiedRequest.messages.length);
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools![0]!.name).toBe("test_tool");
    });

    it("should preserve response data in round-trip", () => {
      const sourceProvider = getProvider(from);
      const unifiedResponse = createUnifiedResponse({
        content: [{ type: "text", text: "Original response" }],
        stopReason: "end_turn",
      });

      const sourceResponse = sourceProvider.transformResponse(unifiedResponse);
      const targetResponse = transformResponse(sourceResponse, { from, to });
      const backToSourceResponse = transformResponse(targetResponse, {
        from: to,
        to: from,
      });

      const parsed = sourceProvider.parseResponse(backToSourceResponse);

      expect((parsed.content[0]! as any).text).toBe("Original response");
      expect(parsed.stopReason).toBe("end_turn");
    });
  });
});

describe("Integration: Complex Scenarios", () => {
  it("should handle multi-turn conversation with tools", () => {
    const request = createUnifiedRequest({
      messages: [
        createUnifiedMessage("user", "What is weather in Seoul?"),
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              toolCall: {
                id: "call_1",
                name: "get_weather",
                arguments: { city: "Seoul" },
              },
            },
          ],
        },
        createUnifiedMessage("user", "What about Tokyo?"),
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              toolCall: {
                id: "call_2",
                name: "get_weather",
                arguments: { city: "Tokyo" },
              },
            },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
            },
            required: ["city"],
          },
        },
      ],
    });

    for (const { from, to } of providerCombinations) {
      const sourceProvider = getProvider(from);
      const sourceRequest = sourceProvider.transform(request);
      const targetRequest = transformRequest(sourceRequest, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parse(targetRequest);

      expect(parsed.messages).toHaveLength(4);
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools![0]!.name).toBe("get_weather");
    }
  });

  it("should handle multi-part responses", () => {
    const response = createUnifiedResponse({
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "there!" },
      ],
      stopReason: "end_turn",
    });

    for (const { from, to } of providerCombinations) {
      const sourceProvider = getProvider(from);
      const sourceResponse = sourceProvider.transformResponse(response);
      const targetResponse = transformResponse(sourceResponse, { from, to });

      expect(targetResponse).toBeDefined();
    }
  });

  it("should handle thinking blocks in response", () => {
    const response = createUnifiedResponse({
      content: [{ type: "text", text: "The answer is 42." }],
      thinking: [{ text: "Let me think about this...", signature: "sig123" }],
      stopReason: "end_turn",
    });

    for (const { from, to } of providerCombinations) {
      const sourceProvider = getProvider(from);
      const sourceResponse = sourceProvider.transformResponse(response);
      const targetResponse = transformResponse(sourceResponse, { from, to });

      expect(targetResponse).toBeDefined();
    }
  });

  it("should handle system prompts", () => {
    const request = createUnifiedRequest({
      system: "You are a helpful assistant.",
      messages: [createUnifiedMessage("user", "Hello!")],
    });

    for (const { from, to } of providerCombinations) {
      const sourceProvider = getProvider(from);
      const sourceRequest = sourceProvider.transform(request);
      const targetRequest = transformRequest(sourceRequest, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parse(targetRequest);

      expect(parsed.messages).toHaveLength(1);
    }
  });

  it("should handle image content in messages", () => {
    const request = createUnifiedRequest({
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image",
              image: {
                mimeType: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
    });

    for (const { from, to } of providerCombinations) {
      const sourceProvider = getProvider(from);
      const sourceRequest = sourceProvider.transform(request);
      const targetRequest = transformRequest(sourceRequest, { from, to });

      expect(targetRequest).toBeDefined();
    }
  });

  it("should handle usage information in responses", () => {
    const response = createUnifiedResponse({
      content: [{ type: "text", text: "Hello!" }],
      stopReason: "end_turn",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        thinkingTokens: 200,
        cachedTokens: 30,
      },
    });

    for (const { from, to } of providerCombinations) {
      const sourceProvider = getProvider(from);
      const sourceResponse = sourceProvider.transformResponse(response);
      const targetResponse = transformResponse(sourceResponse, { from, to });

      const targetProvider = getProvider(to);
      const parsed = targetProvider.parseResponse(targetResponse);

      expect(parsed.usage).toBeDefined();
      expect(parsed.usage?.inputTokens).toBe(100);
      expect(parsed.usage?.outputTokens).toBe(50);
    }
  });
});
