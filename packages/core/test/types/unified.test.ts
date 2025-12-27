import { describe, expect, it } from "bun:test";
import type {
  ContentPart,
  GenerationConfig,
  ImageData,
  JSONSchema,
  JSONSchemaProperty,
  RequestMetadata,
  StopReason,
  StreamChunk,
  ThinkingBlock,
  ThinkingConfig,
  ToolCall,
  ToolResult,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedTool,
  UsageInfo,
} from "../../src/types/unified";

describe("UnifiedRequest", () => {
  it("should accept valid request with required fields", () => {
    const request: UnifiedRequest = {
      messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
    };
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.role).toBe("user");
  });

  it("should accept request with all optional fields", () => {
    const request: UnifiedRequest = {
      messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
      system: "You are a helpful assistant",
      tools: [
        { name: "search", parameters: { type: "object", properties: {} } },
      ],
      config: { maxTokens: 1000, temperature: 0.7 },
      thinking: { enabled: true, budget: 10000 },
      metadata: { userId: "user-123", sessionId: "session-456" },
    };
    expect(request.system).toBe("You are a helpful assistant");
    expect(request.tools).toHaveLength(1);
    expect(request.config?.maxTokens).toBe(1000);
    expect(request.thinking?.enabled).toBe(true);
  });
});

describe("UnifiedResponse", () => {
  it("should accept valid response", () => {
    const response: UnifiedResponse = {
      id: "resp-123",
      content: [{ type: "text", text: "Hello!" }],
      stopReason: "end_turn",
    };
    expect(response.id).toBe("resp-123");
    expect(response.stopReason).toBe("end_turn");
  });

  it("should accept response with usage and thinking", () => {
    const response: UnifiedResponse = {
      id: "resp-456",
      content: [{ type: "text", text: "Response" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      model: "claude-3-opus",
      thinking: [{ text: "Let me think...", signature: "sig123" }],
    };
    expect(response.usage?.inputTokens).toBe(100);
    expect(response.thinking).toHaveLength(1);
  });
});

describe("UnifiedMessage", () => {
  it("should accept all valid roles", () => {
    const roles: Array<UnifiedMessage["role"]> = ["user", "assistant", "tool"];
    for (const role of roles) {
      const msg: UnifiedMessage = { role, parts: [] };
      expect(msg.role).toBe(role);
    }
  });
});

describe("ContentPart", () => {
  it("should accept text content", () => {
    const part: ContentPart = { type: "text", text: "Hello" };
    expect(part.type).toBe("text");
    expect(part.text).toBe("Hello");
  });

  it("should accept image content", () => {
    const part: ContentPart = {
      type: "image",
      image: { mimeType: "image/png", data: "base64data" },
    };
    expect(part.type).toBe("image");
    expect(part.image?.mimeType).toBe("image/png");
  });

  it("should accept tool_call content", () => {
    const part: ContentPart = {
      type: "tool_call",
      toolCall: { id: "call-1", name: "search", arguments: { query: "test" } },
    };
    expect(part.toolCall?.name).toBe("search");
  });

  it("should accept tool_result content", () => {
    const part: ContentPart = {
      type: "tool_result",
      toolResult: { toolCallId: "call-1", content: "Result data" },
    };
    expect(part.toolResult?.toolCallId).toBe("call-1");
  });

  it("should accept thinking content", () => {
    const part: ContentPart = {
      type: "thinking",
      thinking: {
        text: "Reasoning...",
        signature: "sig",
        signatureValid: true,
      },
    };
    expect(part.thinking?.signatureValid).toBe(true);
  });
});

describe("ImageData", () => {
  it("should accept inline data", () => {
    const img: ImageData = { mimeType: "image/jpeg", data: "base64..." };
    expect(img.data).toBeDefined();
  });

  it("should accept URL reference", () => {
    const img: ImageData = {
      mimeType: "image/png",
      url: "https://example.com/img.png",
    };
    expect(img.url).toBeDefined();
  });
});

describe("ToolCall", () => {
  it("should have required fields", () => {
    const call: ToolCall = {
      id: "tc-1",
      name: "calculate",
      arguments: { x: 1, y: 2 },
    };
    expect(call.id).toBe("tc-1");
    expect(call.name).toBe("calculate");
    expect(call.arguments).toEqual({ x: 1, y: 2 });
  });
});

describe("ToolResult", () => {
  it("should accept string content", () => {
    const result: ToolResult = { toolCallId: "tc-1", content: "Result string" };
    expect(result.content).toBe("Result string");
  });

  it("should accept ContentPart array", () => {
    const result: ToolResult = {
      toolCallId: "tc-1",
      content: [{ type: "text", text: "Structured result" }],
    };
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("should accept isError flag", () => {
    const result: ToolResult = {
      toolCallId: "tc-1",
      content: "Error occurred",
      isError: true,
    };
    expect(result.isError).toBe(true);
  });
});

describe("ThinkingBlock", () => {
  it("should have required text field", () => {
    const block: ThinkingBlock = { text: "Thinking content" };
    expect(block.text).toBe("Thinking content");
  });

  it("should accept optional signature fields", () => {
    const block: ThinkingBlock = {
      text: "Reasoning",
      signature: "abc123",
      signatureValid: false,
    };
    expect(block.signature).toBe("abc123");
    expect(block.signatureValid).toBe(false);
  });
});

describe("GenerationConfig", () => {
  it("should accept all generation parameters", () => {
    const config: GenerationConfig = {
      maxTokens: 4096,
      temperature: 0.8,
      topP: 0.95,
      topK: 40,
      stopSequences: ["END", "STOP"],
    };
    expect(config.maxTokens).toBe(4096);
    expect(config.stopSequences).toContain("END");
  });
});

describe("ThinkingConfig", () => {
  it("should require enabled field", () => {
    const config: ThinkingConfig = { enabled: true };
    expect(config.enabled).toBe(true);
  });

  it("should accept optional fields", () => {
    const config: ThinkingConfig = {
      enabled: true,
      budget: 50000,
      includeThoughts: true,
    };
    expect(config.budget).toBe(50000);
    expect(config.includeThoughts).toBe(true);
  });
});

describe("RequestMetadata", () => {
  it("should accept known and custom fields", () => {
    const meta: RequestMetadata = {
      userId: "u1",
      sessionId: "s1",
      conversationId: "c1",
      customField: "custom value",
    };
    expect(meta.userId).toBe("u1");
    expect(meta.customField).toBe("custom value");
  });
});

describe("UsageInfo", () => {
  it("should have required token counts", () => {
    const usage: UsageInfo = { inputTokens: 100, outputTokens: 200 };
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(200);
  });

  it("should accept optional fields", () => {
    const usage: UsageInfo = {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      thinkingTokens: 50,
      cachedTokens: 25,
    };
    expect(usage.totalTokens).toBe(300);
    expect(usage.thinkingTokens).toBe(50);
  });
});

describe("StopReason", () => {
  it("should accept all valid stop reasons", () => {
    const reasons: StopReason[] = [
      "end_turn",
      "max_tokens",
      "tool_use",
      "stop_sequence",
      "content_filter",
      "error",
      null,
    ];
    expect(reasons).toHaveLength(7);
  });
});

describe("UnifiedTool", () => {
  it("should have required fields", () => {
    const tool: UnifiedTool = {
      name: "search",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    };
    expect(tool.name).toBe("search");
  });

  it("should accept optional description", () => {
    const tool: UnifiedTool = {
      name: "calculate",
      description: "Performs calculations",
      parameters: { type: "object" },
    };
    expect(tool.description).toBe("Performs calculations");
  });
});

describe("JSONSchema", () => {
  it("should support object type with properties", () => {
    const schema: JSONSchema = {
      type: "object",
      properties: {
        name: { type: "string", description: "User name" },
        age: { type: "integer" },
      },
      required: ["name"],
    };
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("name");
  });

  it("should support array type with items", () => {
    const schema: JSONSchema = {
      type: "array",
      items: { type: "string" },
    };
    expect(schema.type).toBe("array");
    expect(schema.items?.type).toBe("string");
  });

  it("should support enum", () => {
    const schema: JSONSchema = {
      type: "string",
      enum: ["red", "green", "blue"],
    };
    expect(schema.enum).toContain("red");
  });
});

describe("JSONSchemaProperty", () => {
  it("should support anyOf composition", () => {
    const prop: JSONSchemaProperty = {
      anyOf: [{ type: "string" }, { type: "number" }],
    };
    expect(prop.anyOf).toHaveLength(2);
  });

  it("should support nested objects", () => {
    const prop: JSONSchemaProperty = {
      type: "object",
      properties: {
        nested: { type: "object", properties: { deep: { type: "string" } } },
      },
    };
    expect(prop.properties?.nested?.properties?.deep?.type).toBe("string");
  });
});

describe("StreamChunk", () => {
  it("should support content chunk", () => {
    const chunk: StreamChunk = {
      type: "content",
      delta: { type: "text", text: "Hello" },
    };
    expect(chunk.type).toBe("content");
    expect(chunk.delta?.text).toBe("Hello");
  });

  it("should support done chunk with stop reason", () => {
    const chunk: StreamChunk = {
      type: "done",
      stopReason: "end_turn",
    };
    expect(chunk.type).toBe("done");
    expect(chunk.stopReason).toBe("end_turn");
  });

  it("should support usage chunk", () => {
    const chunk: StreamChunk = {
      type: "usage",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    expect(chunk.usage?.inputTokens).toBe(100);
  });

  it("should support error chunk", () => {
    const chunk: StreamChunk = {
      type: "error",
      error: "Rate limit exceeded",
    };
    expect(chunk.error).toBe("Rate limit exceeded");
  });
});
