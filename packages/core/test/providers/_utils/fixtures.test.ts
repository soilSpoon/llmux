import { describe, expect, it } from "bun:test";
import {
  createUnifiedMessage,
  createUnifiedRequest,
  createUnifiedResponse,
  createUnifiedTool,
  createUnifiedToolCall,
} from "./fixtures";

describe("Unified Fixtures", () => {
  describe("createUnifiedMessage", () => {
    it("should create a simple text message", () => {
      const message = createUnifiedMessage("user", "Hello world");
      expect(message).toEqual({
        role: "user",
        parts: [{ type: "text", text: "Hello world" }],
      });
    });

    it("should create a message with custom role", () => {
      const message = createUnifiedMessage("assistant", "Hello user");
      expect(message.role).toBe("assistant");
    });
  });

  describe("createUnifiedToolCall", () => {
    it("should create a tool call object", () => {
      const toolCall = createUnifiedToolCall("get_weather", { city: "Seoul" });
      expect(toolCall).toEqual({
        id: expect.any(String),
        name: "get_weather",
        arguments: { city: "Seoul" },
      });
    });

    it("should allow custom ID", () => {
      const toolCall = createUnifiedToolCall("test_tool", {}, "custom-id");
      expect(toolCall.id).toBe("custom-id");
    });
  });

  describe("createUnifiedTool", () => {
    it("should create a tool definition", () => {
      const tool = createUnifiedTool("search", "Search the web", {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      });

      expect(tool).toEqual({
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      });
    });
  });

  describe("createUnifiedRequest", () => {
    it("should create a default request with one message", () => {
      const req = createUnifiedRequest();
      expect(req.messages).toHaveLength(1);
      expect(req.messages[0]!.role).toBe("user");
      expect(req.config).toBeDefined();
    });

    it("should allow overriding defaults", () => {
      const req = createUnifiedRequest({
        system: "System prompt",
        messages: [createUnifiedMessage("user", "Test")],
      });
      expect(req.system).toBe("System prompt");
      expect(req.messages).toHaveLength(1);
      expect(req.messages[0]!.parts[0]!.text).toBe("Test");
    });
  });

  describe("createUnifiedResponse", () => {
    it("should create a default response", () => {
      const res = createUnifiedResponse();
      expect(res.id).toBeDefined();
      expect(res.content).toHaveLength(1);
      expect(res.content[0]!.type).toBe("text");
      expect(res.stopReason).toBe("end_turn");
    });

    it("should allow overriding defaults", () => {
      const res = createUnifiedResponse({
        model: "gpt-4",
        content: [{ type: "text", text: "Custom response" }],
      });
      expect(res.model).toBe("gpt-4");
      const firstContent = res.content[0];
      if (firstContent?.type === "text") {
        expect(firstContent.text).toBe("Custom response");
      }
    });
  });
});
