import { describe, expect, it } from "bun:test";
import { transform } from "../../../src/providers/antigravity/request";
import { createUnifiedRequest, createUnifiedMessage } from "../_utils/fixtures";
import type { AntigravityRequest } from "../../../src/providers/antigravity/types";

describe("Antigravity Schema Fix", () => {
  it("should remove 'custom' from required array when 'custom' property is sanitized", () => {
    const unifiedRequest = createUnifiedRequest({
      messages: [createUnifiedMessage("user", "Hello")],
      tools: [
        {
          name: "test_tool",
          description: "A tool with custom property",
          parameters: {
            type: "object",
            properties: {
              regular: { type: "string" },
              custom: { type: "string" }, // This should be removed by sanitizeSchema
            },
            required: ["regular", "custom"],
          },
        },
      ],
    });

    const result = transform(unifiedRequest, "gemini-3-pro-high") as AntigravityRequest;
    
    const tool = result.request.tools?.[0];
    const fn = tool?.functionDeclarations?.[0];
    const params = fn?.parameters;

    expect(params?.properties).toBeDefined();
    expect(params?.properties?.custom).toBeUndefined();
    expect(params?.properties?.regular).toBeDefined();
    
    // The fix: 'custom' should be removed from required array
    expect(params?.required).toContain("regular");
    expect(params?.required).not.toContain("custom");
    expect(params?.required).toHaveLength(1);
  });

  it("should filter out non-existent properties from required array (Gemini safety)", () => {
    const unifiedRequest = createUnifiedRequest({
      messages: [createUnifiedMessage("user", "Hello")],
      tools: [
        {
          name: "invalid_tool",
          description: "A tool with missing property in required array",
          parameters: {
            type: "object",
            properties: {
              active: { type: "boolean" },
            },
            required: ["active", "missing_prop"],
          },
        },
      ],
    });

    const result = transform(unifiedRequest, "gemini-3-pro-high") as AntigravityRequest;
    
    const tool = result.request.tools?.[0];
    const fn = tool?.functionDeclarations?.[0];
    const params = fn?.parameters;

    expect(params?.properties?.active).toBeDefined();
    expect(params?.properties?.missing_prop).toBeUndefined();
    
    // The fix: 'missing_prop' should be filtered out
    expect(params?.required).toContain("active");
    expect(params?.required).not.toContain("missing_prop");
    expect(params?.required).toHaveLength(1);
  });

  it("should handle nested properties correctly", () => {
      const unifiedRequest = createUnifiedRequest({
        messages: [createUnifiedMessage("user", "Hello")],
        tools: [
          {
            name: "nested_tool",
            description: "Nested properties check",
            parameters: {
              type: "object",
              properties: {
                outer: {
                    type: "object",
                    properties: {
                        inner: { type: "string" },
                        custom: { type: "string" }
                    },
                    required: ["inner", "custom"]
                }
              },
              required: ["outer"]
            },
          },
        ],
      });
  
      const result = transform(unifiedRequest, "gemini-3-pro-high") as AntigravityRequest;
      
      const tool = result.request.tools?.[0];
      const fn = tool?.functionDeclarations?.[0];
      const outerParams = fn?.parameters;
      const innerParams = (outerParams?.properties?.outer as any);
  
      expect(innerParams?.properties?.inner).toBeDefined();
      expect(innerParams?.properties?.custom).toBeUndefined();
      
      expect(innerParams?.required).toContain("inner");
      expect(innerParams?.required).not.toContain("custom");
    });
});
