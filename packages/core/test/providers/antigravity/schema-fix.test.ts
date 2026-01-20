import { describe, expect, it } from "bun:test";
import { AntigravityProvider } from "../../../src/providers/antigravity";
import { createUnifiedRequest, createUnifiedMessage } from "../_utils/fixtures";

const provider = new AntigravityProvider();
const transform = (req: any, model: string) => provider.transform(req, model) as any;

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

    const result = transform(unifiedRequest, "gemini-3-pro-high");
    
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

    const result = transform(unifiedRequest, "gemini-3-pro-high");
    
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
  
    const result = transform(unifiedRequest, "gemini-3-pro-high");
    
    // console.log('DEBUG: result.request.tools:', JSON.stringify(result.request.tools, null, 2))

    const tool = result.request.tools?.[0];
      const fn = tool?.functionDeclarations?.[0];
      const outerParams = fn?.parameters;
      // We need to cast to access properties since 'properties' in JSONSchema is Record<string, JSONSchemaProperty>
      // But we know the structure here.
      const outerProps = outerParams?.properties as Record<string, any>;
      const innerParams = outerProps?.outer;
  
      expect(innerParams?.properties?.inner).toBeDefined();
      expect(innerParams?.properties?.custom).toBeUndefined();
      
      expect(innerParams?.required).toContain("inner");
      expect(innerParams?.required).not.toContain("custom");
    });
});
