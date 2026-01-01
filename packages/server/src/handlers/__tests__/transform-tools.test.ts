import { describe, expect, test } from "bun:test";
import { transformToolsForCodex } from "../../providers";

describe("transformToolsForCodex", () => {
  test("transforms ChatCompletion API format (function wrapper) to Responses API format", () => {
    const chatCompletionTools = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_files",
          description: "Search for files",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      },
    ];

    const result = transformToolsForCodex(chatCompletionTools);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "function",
      name: "get_weather",
      description: "Get weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
    });
    expect(result[1]).toEqual({
      type: "function",
      name: "search_files",
      description: "Search for files",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      },
    });
  });

  test("transforms Anthropic format (input_schema) to Responses API format", () => {
    const anthropicTools = [
      {
        name: "Bash",
        description: "Execute shell command",
        input_schema: {
          type: "object",
          properties: {
            cmd: { type: "string", description: "The command to run" },
          },
          required: ["cmd"],
        },
      },
      {
        name: "Read",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
    ];

    const result = transformToolsForCodex(anthropicTools);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "function",
      name: "Bash",
      description: "Execute shell command",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "The command to run" },
        },
        required: ["cmd"],
      },
    });
    expect(result[1]).toEqual({
      type: "function",
      name: "Read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    });
  });

  test("passes through already Responses API format tools", () => {
    const responsesApiTools = [
      {
        type: "function",
        name: "web_search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    ];

    const result = transformToolsForCodex(responsesApiTools);

    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual({
      type: "function",
      name: "web_search",
      description: "Search the web",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      },
    });
  });

  test("handles mixed format tools", () => {
    const mixedTools = [
      // ChatCompletion format
      {
        type: "function",
        function: {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object" },
        },
      },
      // Anthropic format
      {
        name: "tool_b",
        description: "Tool B",
        input_schema: { type: "object" },
      },
      // Responses API format
      {
        type: "function",
        name: "tool_c",
        description: "Tool C",
        parameters: { type: "object" },
      },
    ];

    const result = transformToolsForCodex(mixedTools);

    expect(result).toHaveLength(3);
    expect(result[0]!.name).toBe("tool_a");
    expect(result[1]!.name).toBe("tool_b");
    expect(result[2]!.name).toBe("tool_c");

    // All should have type: "function"
    expect(result.every((t: { type: string }) => t.type === "function")).toBe(true);

    // All should have name at top level (not nested in function)
    expect(result.every((t: { name: string }) => typeof t.name === "string")).toBe(true);
  });

  test("handles empty tools array", () => {
    const result = transformToolsForCodex([]);
    expect(result).toEqual([]);
  });

  test("handles tool without description", () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "simple_tool",
          parameters: { type: "object" },
        },
      },
    ];

    const result = transformToolsForCodex(tools);

    expect(result[0]!.name).toBe("simple_tool");
    expect(result[0]!.description).toBeUndefined();
  });

  test("preserves complex parameter schemas", () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "create_file",
          description: "Create a new file",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "The absolute path to the file",
              },
              content: {
                type: "string",
                description: "The content for the file",
              },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
    ];

    const result = transformToolsForCodex(tools);

    expect(result[0]!.parameters).toEqual({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the file",
        },
        content: {
          type: "string",
          description: "The content for the file",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    });
  });

  test("handles fallback case for malformed tools", () => {
    const malformedTools = [
      { type: "function" }, // No name anywhere
    ];

    const result = transformToolsForCodex(malformedTools);

    expect(result[0]!.type).toBe("function");
    expect(result[0]!.name).toBe("unknown");
  });

  test("handles real Ampcode tools format", () => {
    // Simulating actual tools from Ampcode Oracle requests
    const ampTools = [
      {
        type: "function",
        function: {
          name: "Read",
          description: "Read a file from the file system",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "The absolute path to the file",
              },
              read_range: {
                type: "array",
                items: { type: "number" },
                description: "Line range to read",
              },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "Grep",
          description: "Search for patterns in files",
          parameters: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              path: { type: "string" },
            },
            required: ["pattern"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "glob",
          description: "Find files by pattern",
          parameters: {
            type: "object",
            properties: {
              filePattern: { type: "string" },
              limit: { type: "number" },
            },
            required: ["filePattern"],
          },
        },
      },
    ];

    const result = transformToolsForCodex(ampTools);

    expect(result).toHaveLength(3);
    expect(result.map((t: { name: string }) => t.name)).toEqual(["Read", "Grep", "glob"]);

    // Verify structure is flat (Responses API format)
    for (const tool of result) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect((tool as any).function).toBeUndefined(); // No nested function
    }
  });

  describe("Edge Cases - Schema Complexity", () => {
    test("handles nested parameters with allOf", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "complex_tool",
            description: "Tool with complex schema",
            parameters: {
              type: "object",
              allOf: [
                {
                  type: "object",
                  properties: {
                    base_param: { type: "string" },
                  },
                },
                {
                  type: "object",
                  properties: {
                    extended_param: { type: "number" },
                  },
                },
              ],
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("complex_tool");
      expect(result[0]!.parameters).toBeDefined();
    });

    test("handles $ref and $defs in schema", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "referenced_tool",
            parameters: {
              type: "object",
              properties: {
                config: { $ref: "#/$defs/ConfigType" },
              },
              $defs: {
                ConfigType: {
                  type: "object",
                  properties: {
                    setting: { type: "string" },
                  },
                },
              },
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("referenced_tool");
      // Schema should be preserved as-is (Codex handles it)
      expect(result[0]!.parameters).toBeDefined();
    });

    test("handles deeply nested object properties", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "nested_tool",
            parameters: {
              type: "object",
              properties: {
                level1: {
                  type: "object",
                  properties: {
                    level2: {
                      type: "object",
                      properties: {
                        level3: {
                          type: "object",
                          properties: {
                            value: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("nested_tool");
      // Deep nesting should be preserved
      const params = result[0]!.parameters as any;
      expect(
        params.properties.level1.properties.level2.properties.level3
      ).toBeDefined();
    });

    test("handles array items with complex types", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "array_tool",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      metadata: {
                        type: "object",
                        properties: {
                          tags: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("array_tool");
      const params = result[0]!.parameters as any;
      expect(params.properties.items.type).toBe("array");
      expect(params.properties.items.items.properties.metadata).toBeDefined();
    });

    test("handles tools with constrained parameters (minLength, pattern, etc)", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "constrained_tool",
            parameters: {
              type: "object",
              properties: {
                email: {
                  type: "string",
                  format: "email",
                  pattern: "^[^@]+@[^@]+\\.[^@]+$",
                  minLength: 5,
                  maxLength: 100,
                },
                age: {
                  type: "integer",
                  minimum: 0,
                  maximum: 120,
                },
                tags: {
                  type: "array",
                  minItems: 1,
                  maxItems: 10,
                  items: { type: "string" },
                },
              },
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("constrained_tool");
      // Constraints should be preserved in the schema
      const params = result[0]!.parameters as any;
      expect(params.properties.email).toBeDefined();
      expect(params.properties.email.minLength).toBe(5);
      expect(params.properties.age.minimum).toBe(0);
    });

    test("handles very large parameter schemas (100+ fields)", () => {
      const properties: Record<string, unknown> = {};
      for (let i = 0; i < 150; i++) {
        properties[`field_${i}`] = {
          type: "string",
          description: `Field number ${i}`,
        };
      }

      const tools = [
        {
          type: "function",
          function: {
            name: "large_schema_tool",
            parameters: {
              type: "object",
              properties,
              required: Object.keys(properties).slice(0, 10),
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("large_schema_tool");
      const params = result[0]!.parameters as any;
      expect(Object.keys(params.properties).length).toBe(150);
    });

    test("handles tools with null and undefined fields", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "sparse_tool",
            parameters: undefined,
          },
        } as any,
        {
          type: "function",
          function: {
            name: "null_tool",
            parameters: null,
          },
        } as any,
        {
          type: "function",
          function: {
            name: "normal_tool",
            parameters: {
              type: "object",
              properties: {
                field: { type: "string" },
              },
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(3);
      expect(result[0]!.name).toBe("sparse_tool");
      expect(result[1]!.name).toBe("null_tool");
      expect(result[2]!.name).toBe("normal_tool");
    });

    test("preserves unicode characters in descriptions and property names", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "unicode_tool",
            description: "Tool für Deutsch 中文 日本語 한국어",
            parameters: {
              type: "object",
              properties: {
                données: { type: "string", description: "Données françaises" },
                datos: { type: "string", description: "Datos españoles 😀" },
                資料: { type: "string", description: "日本のデータ" },
              },
            },
          },
        },
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.description).toContain("中文");
      const params = result[0]!.parameters as any;
      expect(params.properties.données).toBeDefined();
      expect(params.properties.資料).toBeDefined();
    });

    test("handles tool definitions with extra unknown fields", () => {
      const tools = [
        {
          type: "function",
          function: {
            name: "extra_fields_tool",
            description: "Tool with extra fields",
            parameters: { type: "object" },
            extra_field_1: "should be ignored",
            extra_field_2: 123,
          },
        } as any,
      ];

      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect((result[0]! as any).extra_field_1).toBeUndefined();
    });

    test("handles recursive/circular schema references gracefully", () => {
      const circularSchema: any = {
        type: "object",
        properties: {
          id: { type: "string" },
          child: {} as any,
        },
      };
      // Create circular reference
      circularSchema.properties.child = circularSchema;

      const tools = [
        {
          type: "function",
          function: {
            name: "circular_tool",
            parameters: circularSchema,
          },
        },
      ];

      // Should not crash/infinite loop
      const result = transformToolsForCodex(tools);

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("circular_tool");
    });
  });
});
