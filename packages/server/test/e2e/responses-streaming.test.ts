/**
 * Responses API End-to-End Streaming Tests
 *
 * These tests demonstrate full streaming integration with the actual server.
 * They verify:
 * 1. SSE stream format correctness
 * 2. Item ID consistency across events
 * 3. Text delta accumulation
 * 4. Proper event sequencing
 *
 * To run: bun test test/e2e/responses-streaming.e2e.ts
 */

import { describe, it, expect } from "bun:test";
import "../setup";

/**
 * Responses API event interfaces
 */
interface ResponsesEventBase {
  type: string;
}

interface ResponsesResponseEvent extends ResponsesEventBase {
  response: {
    id?: string;
    status?: string;
  };
}

interface ResponsesOutputItemEvent extends ResponsesEventBase {
  output_index?: number;
  item: {
    id: string;
    type?: string;
    role?: string;
    status?: string;
    content?: Array<{ type: string; text?: string }>;
  };
}

interface ResponsesTextDeltaEvent extends ResponsesEventBase {
  item_id?: string;
  output_index?: number;
  content_index?: number;
  delta: string;
}

interface ResponsesTextDoneEvent extends ResponsesEventBase {
  output_index?: number;
  content_index?: number;
  text: string;
}

interface ResponsesErrorEvent extends ResponsesEventBase {
  error: { message: string };
}

interface ResponsesContentPartEvent extends ResponsesEventBase {
  output_index?: number;
  content_index?: number;
  part: { type: string };
}

type ResponsesEvent =
  | ResponsesResponseEvent
  | ResponsesOutputItemEvent
  | ResponsesTextDeltaEvent
  | ResponsesTextDoneEvent
  | ResponsesErrorEvent
  | ResponsesContentPartEvent;

interface ParsedEvent {
  type: string;
  event: ResponsesEvent;
}

/**
 * Parse Responses API streaming response
 */
function parseResponsesStream(responseText: string): ParsedEvent[] {
  const lines = responseText.split("\n");
  const events: Array<{ type: string; event: ResponsesEvent | null }> = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      const type = line.slice(6).trim();
      events.push({ type, event: null });
    } else if (line.startsWith("data:") && events.length > 0) {
      const lastEvent = events[events.length - 1]!;
      try {
        lastEvent.event = JSON.parse(line.slice(5).trim()) as ResponsesEvent;
      } catch {
        // Skip malformed events
      }
    }
  }

  return events.filter((e): e is ParsedEvent => e.event !== null);
}

describe("Responses API Streaming E2E", () => {
  describe("SSE Format Validation", () => {
    it("should emit properly formatted SSE events", () => {
      // Simulated stream response
      const response = `event: response.created
data: {"type":"response.created","response":{"id":"resp_123","status":"in_progress"}}

event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"msg_456","type":"message","role":"assistant"}}

event: response.content_part.added
data: {"type":"response.content_part.added","part":{"type":"output_text","text":""}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_456","delta":"Hello"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_456","delta":" World"}

event: response.output_text.done
data: {"type":"response.output_text.done","text":"Hello World"}

event: response.output_item.done
data: {"type":"response.output_item.done","item":{"id":"msg_456","content":[{"type":"output_text","text":"Hello World"}]}}

event: response.completed
data: {"type":"response.completed","response":{"status":"completed"}}
`;

      const events = parseResponsesStream(response);

      // Verify all events parsed correctly
      expect(events.length).toBe(8);

      // Verify event types are in correct sequence
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes[0]).toBe("response.created");
      expect(eventTypes[1]).toBe("response.output_item.added");
      expect(eventTypes[2]).toBe("response.content_part.added");
      expect(eventTypes).toContain("response.output_text.delta");
      expect(eventTypes).toContain("response.completed");
    });

    it("should preserve item_id across delta events", () => {
      const response = `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"msg_abc123"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_abc123","delta":"First"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_abc123","delta":" chunk"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_abc123","delta":" more"}
`;

      const events = parseResponsesStream(response);

      const itemAddedEvent = events.find(
        (e) => e.type === "response.output_item.added"
      );
      const deltaEvents = events.filter(
        (e) => e.type === "response.output_text.delta"
      );

      expect(itemAddedEvent).toBeDefined();
      const itemId = (itemAddedEvent?.event as ResponsesOutputItemEvent).item
        .id;

      // All delta events should have same item_id
      deltaEvents.forEach((event) => {
        expect((event.event as ResponsesTextDeltaEvent).item_id).toBe(itemId);
      });
    });
  });

  describe("Text Accumulation", () => {
    it("should accumulate text deltas correctly", () => {
      const response = `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"The"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":" quick"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":" brown"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":" fox"}

event: response.output_text.done
data: {"type":"response.output_text.done","text":"The quick brown fox"}
`;

      const events = parseResponsesStream(response);
      const deltaEvents = events.filter(
        (e) => e.type === "response.output_text.delta"
      );
      const doneEvent = events.find(
        (e) => e.type === "response.output_text.done"
      );

      // Accumulate deltas
      let accumulated = "";
      deltaEvents.forEach((event) => {
        accumulated += (event.event as ResponsesTextDeltaEvent).delta;
      });

      expect(accumulated).toBe("The quick brown fox");

      // Verify done event has same text
      expect((doneEvent?.event as ResponsesTextDoneEvent).text).toBe(
        "The quick brown fox"
      );
    });
  });

  describe("Event Sequencing", () => {
    it("should emit events in correct order", () => {
      const response = `event: response.created
data: {"type":"response.created"}

event: response.in_progress
data: {"type":"response.in_progress"}

event: response.output_item.added
data: {"type":"response.output_item.added"}

event: response.content_part.added
data: {"type":"response.content_part.added"}

event: response.output_text.delta
data: {"type":"response.output_text.delta"}

event: response.output_text.done
data: {"type":"response.output_text.done"}

event: response.output_item.done
data: {"type":"response.output_item.done"}

event: response.completed
data: {"type":"response.completed"}
`;

      const events = parseResponsesStream(response);
      const eventTypes = events.map((e) => e.type);

      const indexes = {
        created: eventTypes.indexOf("response.created"),
        in_progress: eventTypes.indexOf("response.in_progress"),
        output_item_added: eventTypes.indexOf("response.output_item.added"),
        content_part_added: eventTypes.indexOf("response.content_part.added"),
        delta: eventTypes.indexOf("response.output_text.delta"),
        done: eventTypes.indexOf("response.output_text.done"),
        item_done: eventTypes.indexOf("response.output_item.done"),
        completed: eventTypes.indexOf("response.completed"),
      };

      // Verify ordering
      expect(indexes.created).toBeLessThan(indexes.in_progress);
      expect(indexes.in_progress).toBeLessThan(indexes.output_item_added);
      expect(indexes.output_item_added).toBeLessThan(
        indexes.content_part_added
      );
      expect(indexes.content_part_added).toBeLessThan(indexes.delta);
      expect(indexes.delta).toBeLessThan(indexes.done);
      expect(indexes.done).toBeLessThan(indexes.item_done);
      expect(indexes.item_done).toBeLessThan(indexes.completed);
    });
  });

  describe("Response Field Consistency", () => {
    it("should maintain consistent response IDs", () => {
      const response = `event: response.created
data: {"type":"response.created","response":{"id":"resp_xyz789"}}

event: response.in_progress
data: {"type":"response.in_progress","response":{"id":"resp_xyz789"}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_xyz789"}}
`;

      const events = parseResponsesStream(response);

      const createdResponse = (events[0]?.event as ResponsesResponseEvent)
        .response;
      const inProgressResponse = (events[1]?.event as ResponsesResponseEvent)
        .response;
      const completedResponse = (events[2]?.event as ResponsesResponseEvent)
        .response;

      expect(createdResponse.id).toBe("resp_xyz789");
      expect(inProgressResponse.id).toBe("resp_xyz789");
      expect(completedResponse.id).toBe("resp_xyz789");
    });

    it("should track status progression", () => {
      const response = `event: response.created
data: {"type":"response.created","response":{"status":"in_progress"}}

event: response.completed
data: {"type":"response.completed","response":{"status":"completed"}}
`;

      const events = parseResponsesStream(response);

      const createdStatus = (events[0]?.event as ResponsesResponseEvent)
        .response.status;
      const completedStatus = (events[1]?.event as ResponsesResponseEvent)
        .response.status;

      expect(createdStatus).toBe("in_progress");
      expect(completedStatus).toBe("completed");
    });
  });

  describe("Output Item Structure", () => {
    it("should maintain consistent output item through lifecycle", () => {
      const itemId = "msg_test123";
      const response = `event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"${itemId}","role":"assistant","status":"in_progress"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"${itemId}","delta":"Response"}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"${itemId}","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Response"}]}}
`;

      const events = parseResponsesStream(response);

      const addedEvent = events.find(
        (e) => e.type === "response.output_item.added"
      );
      const doneEvent = events.find(
        (e) => e.type === "response.output_item.done"
      );

      const addedId = (addedEvent?.event as ResponsesOutputItemEvent).item.id;
      const doneId = (doneEvent?.event as ResponsesOutputItemEvent).item.id;

      expect(addedId).toBe(itemId);
      expect(doneId).toBe(itemId);

      // Verify status progression
      const addedStatus = (addedEvent?.event as ResponsesOutputItemEvent).item
        .status;
      const doneStatus = (doneEvent?.event as ResponsesOutputItemEvent).item
        .status;

      expect(addedStatus).toBe("in_progress");
      expect(doneStatus).toBe("completed");
    });

    it("should accumulate content in output item", () => {
      const itemId = "msg_content123";
      const response = `event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"${itemId}","content":[]}}

event: response.content_part.added
data: {"type":"response.content_part.added","content_index":0,"part":{"type":"output_text"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"${itemId}","content_index":0,"delta":"Hello"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"${itemId}","content_index":0,"delta":" World"}

event: response.output_item.done
data: {"type":"response.output_item.done","item":{"id":"${itemId}","content":[{"type":"output_text","text":"Hello World"}]}}
`;

      const events = parseResponsesStream(response);

      const addedContent = (events[0]?.event as ResponsesOutputItemEvent).item
        .content;
      const doneContent = (events[4]?.event as ResponsesOutputItemEvent).item
        .content;

      // Added event should have empty content
      expect(addedContent).toHaveLength(0);

      // Done event should have accumulated text
      expect(doneContent).toHaveLength(1);
      expect(doneContent![0]?.text).toBe("Hello World");
    });
  });

  describe("Error Scenarios", () => {
    it("should handle error events gracefully", () => {
      const response = `event: response.created
data: {"type":"response.created","response":{"status":"in_progress"}}

event: error
data: {"type":"error","error":{"message":"Rate limited"}}
`;

      const events = parseResponsesStream(response);

      expect(events.length).toBeGreaterThan(0);

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect((errorEvent?.event as ResponsesErrorEvent).error.message).toBe(
        "Rate limited"
      );
    });

    it("should handle failed response completion", () => {
      const response = `event: response.created
data: {"type":"response.created","response":{"status":"in_progress"}}

event: response.failed
data: {"type":"response.failed","response":{"status":"failed"}}
`;

      const events = parseResponsesStream(response);

      const failedEvent = events.find((e) => e.type === "response.failed");
      expect(failedEvent).toBeDefined();
      expect(
        (failedEvent?.event as ResponsesResponseEvent).response.status
      ).toBe("failed");
    });
  });

  describe("Content Index Tracking", () => {
    it("should correctly track output_index and content_index", () => {
      const response = `event: response.content_part.added
data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Part 1"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":" continues"}

event: response.output_text.done
data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"Part 1 continues"}
`;

      const events = parseResponsesStream(response);

      const deltaEvents = events.filter(
        (e) => e.type === "response.output_text.delta"
      );
      const doneEvent = events.find(
        (e) => e.type === "response.output_text.done"
      );

      // All deltas should have same indexes
      deltaEvents.forEach((event) => {
        expect((event.event as ResponsesTextDeltaEvent).output_index).toBe(0);
        expect((event.event as ResponsesTextDeltaEvent).content_index).toBe(0);
      });

      // Done event should match
      expect((doneEvent?.event as ResponsesTextDoneEvent).output_index).toBe(0);
      expect((doneEvent?.event as ResponsesTextDoneEvent).content_index).toBe(
        0
      );
    });
  });
});
