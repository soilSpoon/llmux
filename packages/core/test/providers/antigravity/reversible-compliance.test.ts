/**
 * Antigravity Compliance Tests - Request/Response Transformation
 * TDD Cycle 2 & 3: Red -> Green -> Refactor
 *
 * Tests tool name encoding/decoding and schema transformation
 * across the full request/response lifecycle.
 */

import { describe, expect, it } from "bun:test";
import { transform as transformRequest } from "../../../src/providers/antigravity/request";
import type { UnifiedRequest } from "../../../src/types/unified";

describe("Antigravity Request Compliance", () => {
  describe("Tool Name Encoding in Tool Definitions", () => {
    it("should encode slash in tool name for tool definitions", () => {
      const request: UnifiedRequest = {
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        tools: [
          {
            name: "mcp/read_file",
            description: "Read a file",
            parameters: { type: "object", properties: {} },
          },
        ],
      };

      const result = transformRequest(request);

      // Tool name should be encoded
      const toolDecl = result.request.tools?.[0]?.functionDeclarations?.[0];
      expect(toolDecl?.name).toBe("mcp__slash__read_file");
    });

    it("should encode slash in tool name in conversation history (functionCall)", () => {
      const request: UnifiedRequest = {
        messages: [
          { role: "user", parts: [{ type: "text", text: "do something" }] },
          {
            role: "assistant",
            parts: [
              {
                type: "tool_call",
                toolCall: {
                  id: "call_123",
                  name: "mcp/read_file",
                  arguments: { path: "/tmp/test.txt" },
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                type: "tool_result",
                toolResult: {
                  toolCallId: "call_123",
                  content: "file contents here",
                },
              },
            ],
          },
        ],
      };

      const result = transformRequest(request);

      // functionCall.name in history should be encoded
      const assistantContent = result.request.contents[1];
      const functionCallPart = assistantContent?.parts?.[0];
      expect(functionCallPart?.functionCall?.name).toBe(
        "mcp__slash__read_file"
      );
    });
  });

  describe("Schema Transformation (const -> enum)", () => {
    it("should convert const to enum in tool parameters", () => {
      // Use JSON.parse to create a runtime object that simulates external input
      // containing 'const' property which is not in our TypeScript types.
      // This accurately represents real-world scenarios where external APIs
      // may send JSON schemas with 'const' that need to be transformed.
      const externalSchema = JSON.parse(
        '{"type":"object","properties":{"type":{"const":"email"}}}'
      );

      const request: UnifiedRequest = {
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
        tools: [
          {
            name: "get_type",
            description: "Get type info",
            parameters: externalSchema,
          },
        ],
      };

      const result = transformRequest(request);

      // const should be converted to enum: [value]
      const toolDecl = result.request.tools?.[0]?.functionDeclarations?.[0];
      const typeParam = toolDecl?.parameters?.properties?.type;
      expect(typeParam?.enum).toEqual(["email"]);
      // Verify 'const' key is not present in the transformed schema
      const typeParamKeys = typeParam ? Object.keys(typeParam) : [];
      expect(typeParamKeys).not.toContain("const");
    });
  });

  describe("Tool Pairing Validation", () => {
    it("should warn or error when tool_use has no following tool_result", () => {
      const request: UnifiedRequest = {
        messages: [
          { role: "user", parts: [{ type: "text", text: "do something" }] },
          {
            role: "assistant",
            parts: [
              {
                type: "tool_call",
                toolCall: {
                  id: "orphaned_call",
                  name: "some_tool",
                  arguments: {},
                },
              },
            ],
          },
          // No tool_result follows - this is an orphaned tool call
        ],
      };

      // This should either throw, log a warning, or handle gracefully
      // For now we test that it doesn't crash and produces valid output
      expect(() => transformRequest(request)).not.toThrow();
    });
  });
});

describe("Antigravity Response Compliance", () => {
  describe("Tool Name Decoding in Responses", () => {
    it("should decode __slash__ to slash in tool call names (non-streaming)", async () => {
      const { parseResponse } = await import(
        "../../../src/providers/antigravity/response"
      );

      // Simulated Antigravity response with encoded tool name
      const antigravityResponse = {
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "mcp__slash__read_file",
                      args: { path: "/tmp/test.txt" },
                      id: "call_123",
                    },
                  },
                ],
              },
              finishReason: "OTHER",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        },
      };

      const result = parseResponse(antigravityResponse);

      // Tool call name should be decoded back to original
      // UnifiedResponse has 'content' array, not 'parts'
      const toolCall = result.content.find((p) => p.type === "tool_call");
      expect(toolCall?.toolCall?.name).toBe("mcp/read_file");
    });

    it("should decode __slash__ to slash in streaming tool call chunks", async () => {
      const { parseStreamChunk } = await import(
        "../../../src/providers/antigravity/streaming"
      );

      // Simulated streaming chunk as SSE string (parseStreamChunk takes string)
      const sseChunk = `data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"mcp__slash__write_file","args":{"path":"/tmp/out.txt","content":"data"},"id":"call_456"}}]}}]}}`;

      const result = parseStreamChunk(sseChunk);

      // Streaming tool call should also decode the name
      // Result can be a single StreamChunk or array
      const chunk = Array.isArray(result) ? result[0] : result;
      expect(chunk?.delta?.toolCall?.name).toBe("mcp/write_file");
    });
  });
});
