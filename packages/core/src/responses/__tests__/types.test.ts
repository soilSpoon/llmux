import { describe, expect, it } from "bun:test";
import type {
  ResponsesContentPart,
  ResponsesInputMessage,
  ResponsesOutputContent,
  ResponsesOutputItem,
  ResponsesRequest,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesUsage,
} from "../types";

describe("ResponsesRequest types", () => {
  it("should accept minimal request with string input", () => {
    const request: ResponsesRequest = {
      model: "gpt-4o",
      input: "Hello, world!",
    };
    expect(request.model).toBe("gpt-4o");
    expect(request.input).toBe("Hello, world!");
  });

  it("should accept request with message array input", () => {
    const messages: ResponsesInputMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    const request: ResponsesRequest = {
      model: "gpt-4o",
      input: messages,
    };
    expect(Array.isArray(request.input)).toBe(true);
  });

  it("should accept request with all optional fields", () => {
    const request: ResponsesRequest = {
      model: "gpt-4o",
      input: "Hello",
      instructions: "You are a helpful assistant",
      stream: true,
      temperature: 0.7,
      max_output_tokens: 1000,
      top_p: 0.9,
      store: false,
      metadata: { user_id: "123" },
    };
    expect(request.instructions).toBe("You are a helpful assistant");
    expect(request.stream).toBe(true);
  });

  it("should accept message with content parts", () => {
    const part: ResponsesContentPart = {
      type: "input_text",
      text: "Hello",
    };
    const message: ResponsesInputMessage = {
      role: "user",
      content: [part],
    };
    expect(message.role).toBe("user");
    expect(Array.isArray(message.content)).toBe(true);
  });

  it("should accept all role types", () => {
    const roles: ResponsesInputMessage["role"][] = [
      "user",
      "assistant",
      "system",
      "developer",
    ];
    roles.forEach((role) => {
      const message: ResponsesInputMessage = { role, content: "test" };
      expect(message.role).toBe(role);
    });
  });

  it("should accept all content part types", () => {
    const types: ResponsesContentPart["type"][] = [
      "input_text",
      "input_image",
      "input_audio",
      "input_file",
    ];
    types.forEach((type) => {
      const part: ResponsesContentPart = { type };
      expect(part.type).toBe(type);
    });
  });
});

describe("ResponsesResponse types", () => {
  it("should accept minimal response", () => {
    const response: ResponsesResponse = {
      id: "resp_123",
      object: "response",
      created_at: 1234567890,
      status: "completed",
      output: [],
    };
    expect(response.id).toBe("resp_123");
    expect(response.object).toBe("response");
  });

  it("should accept response with output items", () => {
    const outputContent: ResponsesOutputContent = {
      type: "output_text",
      text: "Hello!",
    };
    const outputItem: ResponsesOutputItem = {
      type: "message",
      id: "msg_123",
      role: "assistant",
      content: [outputContent],
      status: "completed",
    };
    const response: ResponsesResponse = {
      id: "resp_123",
      object: "response",
      created_at: 1234567890,
      status: "completed",
      output: [outputItem],
    };
    expect(response.output).toHaveLength(1);
    expect(response.output[0]?.content[0]?.text).toBe("Hello!");
  });

  it("should accept response with usage", () => {
    const usage: ResponsesUsage = {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    };
    const response: ResponsesResponse = {
      id: "resp_123",
      object: "response",
      created_at: 1234567890,
      status: "completed",
      output: [],
      usage,
      model: "gpt-4o",
    };
    expect(response.usage?.total_tokens).toBe(30);
  });

  it("should accept all status types", () => {
    const statuses: ResponsesResponse["status"][] = [
      "completed",
      "failed",
      "in_progress",
      "incomplete",
    ];
    statuses.forEach((status) => {
      const response: ResponsesResponse = {
        id: "resp_123",
        object: "response",
        created_at: 1234567890,
        status,
        output: [],
      };
      expect(response.status).toBe(status);
    });
  });

  it("should accept output content with annotations", () => {
    const content: ResponsesOutputContent = {
      type: "output_text",
      text: "Hello",
      annotations: [{ type: "file_citation", file_id: "file_123" }],
    };
    expect(content.annotations).toHaveLength(1);
  });
});

describe("ResponsesStreamEvent types", () => {
  it("should accept response.created event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.created",
      response: {
        id: "resp_123",
        object: "response",
        created_at: 1234567890,
        status: "in_progress",
        output: [],
      },
    };
    expect(event.type).toBe("response.created");
  });

  it("should accept response.in_progress event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.in_progress",
      response: {
        id: "resp_123",
        object: "response",
        created_at: 1234567890,
        status: "in_progress",
        output: [],
      },
    };
    expect(event.type).toBe("response.in_progress");
  });

  it("should accept response.output_item.added event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_123",
        role: "assistant",
        content: [],
        status: "in_progress",
      },
    };
    expect(event.type).toBe("response.output_item.added");
    expect(event.output_index).toBe(0);
  });

  it("should accept response.content_part.added event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: {
        type: "output_text",
        text: "",
      },
    };
    expect(event.type).toBe("response.content_part.added");
  });

  it("should accept response.output_text.delta event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.output_text.delta",
      item_id: "item_123",
      output_index: 0,
      content_index: 0,
      delta: "Hello",
    };
    expect(event.type).toBe("response.output_text.delta");
    if (event.type === "response.output_text.delta") {
      expect(event.delta).toBe("Hello");
    }
  });

  it("should accept response.output_text.done event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: "Hello, world!",
    };
    expect(event.type).toBe("response.output_text.done");
    expect(event.text).toBe("Hello, world!");
  });

  it("should accept response.output_item.done event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_123",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello" }],
        status: "completed",
      },
    };
    expect(event.type).toBe("response.output_item.done");
  });

  it("should accept response.completed event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.completed",
      response: {
        id: "resp_123",
        object: "response",
        created_at: 1234567890,
        status: "completed",
        output: [],
      },
    };
    expect(event.type).toBe("response.completed");
  });

  it("should accept response.failed event", () => {
    const event: ResponsesStreamEvent = {
      type: "response.failed",
      response: {
        id: "resp_123",
        object: "response",
        created_at: 1234567890,
        status: "failed",
        output: [],
      },
    };
    expect(event.type).toBe("response.failed");
  });

  it("should accept error event", () => {
    const event: ResponsesStreamEvent = {
      type: "error",
      error: {
        message: "Something went wrong",
        code: "internal_error",
      },
    };
    expect(event.type).toBe("error");
    expect(event.error.message).toBe("Something went wrong");
  });

  it("should accept error event without code", () => {
    const event: ResponsesStreamEvent = {
      type: "error",
      error: {
        message: "Something went wrong",
      },
    };
    expect(event.error.code).toBeUndefined();
  });
});
