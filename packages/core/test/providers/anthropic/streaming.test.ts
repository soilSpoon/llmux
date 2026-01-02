import { describe, expect, it } from "bun:test";
import {
  parseStreamChunk,
  transformStreamChunk,
} from "../../../src/providers/anthropic/streaming";
import type { StreamChunk } from "../../../src/types/unified";

describe("Anthropic Streaming Transformations", () => {
  describe("parseStreamChunk", () => {
    it("should parse message_start event", () => {
      const sseData = `event: message_start
data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("usage");
      expect(result?.usage?.inputTokens).toBe(10);
    });

    it("should parse text content_block_start event", () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("content");
      expect(result?.blockIndex).toBe(0);
      expect(result?.blockType).toBe("text");
    });

    it("should parse text_delta event", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("content");
      expect(result?.delta?.text).toBe("Hello");
    });

    it("should parse thinking content_block_start event", () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`;

      const result = parseStreamChunk(sseData);

      // content_block_start for thinking may or may not produce a chunk
      expect(result === null || result?.type === "thinking").toBe(true);
    });

    it("should parse thinking_delta event", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("thinking");
      expect(result?.delta?.thinking?.text).toBe("Let me think...");
    });

    it("should parse signature_delta event", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("thinking");
      expect(result?.delta?.thinking?.signature).toBe("EqQBCgIYAhIM");
    });

    it("should parse tool_use content_block_start event", () => {
      const sseData = `event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather","input":{}}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("tool_call");
      expect(result?.delta?.toolCall?.id).toBe("toolu_123");
      expect(result?.delta?.toolCall?.name).toBe("get_weather");
    });

    it("should parse input_json_delta event to partialJson", () => {
      const sseData = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"NYC"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("tool_call");
      expect(result?.delta?.partialJson).toBe('{"location": "NYC');
    });

    it("should parse content_block_stop event", () => {
      const sseData = `event: content_block_stop
data: {"type":"content_block_stop","index":0}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("block_stop");
      expect(result?.blockIndex).toBe(0);
    });

    it("should parse message_delta event with stop_reason", () => {
      const sseData = `event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.stopReason).toBe("end_turn");
      expect(result?.usage?.outputTokens).toBe(50);
    });

    it("should parse message_stop event", () => {
      const sseData = `event: message_stop
data: {"type":"message_stop"}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("done");
    });

    it("should parse ping event", () => {
      const sseData = `event: ping
data: {"type":"ping"}`;

      const result = parseStreamChunk(sseData);

      // Ping events are typically ignored
      expect(result).toBeNull();
    });

    it("should parse error event", () => {
      const sseData = `event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("error");
      expect(result?.error).toContain("Overloaded");
    });

    it("should handle malformed SSE data gracefully", () => {
      const sseData = "not valid sse";

      const result = parseStreamChunk(sseData);

      expect(result).toBeNull();
    });

    it("should handle empty data", () => {
      const sseData = "";

      const result = parseStreamChunk(sseData);

      expect(result).toBeNull();
    });

    it("should handle data-only format (without event line)", () => {
      const sseData = `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}`;

      const result = parseStreamChunk(sseData);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("content");
      expect(result?.delta?.text).toBe("Hi");
    });

    it("should handle tool_use stop_reason", () => {
      const sseData = `event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":30}}`;

      const result = parseStreamChunk(sseData);

      expect(result?.stopReason).toBe("tool_use");
    });

    it("should handle max_tokens stop_reason", () => {
      const sseData = `event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"output_tokens":4096}}`;

      const result = parseStreamChunk(sseData);

      expect(result?.stopReason).toBe("max_tokens");
    });
  });

  describe("transformStreamChunk", () => {
    it("should transform content chunk to text_delta SSE", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: { text: "Hello, world!" },
      };

      const result = transformStreamChunk(chunk);

      expect(result).toContain("event: content_block_delta");
      expect(result).toContain("text_delta");
      expect(result).toContain("Hello, world!");
    });

    it("should transform thinking chunk to thinking_delta SSE", () => {
      const chunk: StreamChunk = {
        type: "thinking",
        delta: {
          thinking: {
            text: "Let me analyze...",
          },
        },
      };

      const result = transformStreamChunk(chunk);

      expect(result).toContain("event: content_block_delta");
      expect(result).toContain("thinking_delta");
      expect(result).toContain("Let me analyze...");
    });

    it("should transform thinking chunk with signature to signature_delta SSE", () => {
      const chunk: StreamChunk = {
        type: "thinking",
        delta: {
          thinking: {
            text: "",
            signature: "EqQBCgIYAhIM",
          },
        },
      };

      const result = transformStreamChunk(chunk);

      expect(result).toContain("signature_delta");
      expect(result).toContain("EqQBCgIYAhIM");
    });

    it("should transform tool_call chunk to content_block_start SSE", () => {
      const chunk: StreamChunk = {
        type: "tool_call",
        delta: {
          toolCall: {
            id: "toolu_123",
            name: "get_weather",
            arguments: {},
          },
        },
      };

      const result = transformStreamChunk(chunk);
      const output = Array.isArray(result) ? result.join("") : result;

      // Should contain content_block_start with tool_use
      expect(output).toContain("content_block_start");
      expect(output).toContain("tool_use");
      expect(output).toContain("toolu_123");
      expect(output).toContain("get_weather");
      // Empty object {} now also produces input_json_delta
      expect(output).toContain("input_json_delta");
      expect(output).toContain("{}");
    });

    it("should transform done chunk to message_stop SSE", () => {
      const chunk: StreamChunk = {
        type: "done",
      };

      const result = transformStreamChunk(chunk);
      const output = Array.isArray(result) ? result.join("") : result;

      expect(output).toContain("event: message_stop");
      expect(output).toContain("message_stop");
    });

    it("should transform error chunk to error SSE", () => {
      const chunk: StreamChunk = {
        type: "error",
        error: "Something went wrong",
      };

      const result = transformStreamChunk(chunk);

      expect(result).toContain("event: error");
      expect(result).toContain("Something went wrong");
    });

    it("should transform usage chunk to message_delta SSE", () => {
      const chunk: StreamChunk = {
        type: "usage",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
        stopReason: "end_turn",
      };

      const result = transformStreamChunk(chunk);

      expect(result).toContain("event: message_delta");
      expect(result).toContain("end_turn");
      expect(result).toContain("output_tokens");
    });

    it("should handle chunk with stop_reason", () => {
      const chunk: StreamChunk = {
        type: "content",
        delta: { text: "Final text" },
        stopReason: "end_turn",
      };

      const result = transformStreamChunk(chunk);

      expect(result).toContain("text_delta");
    });
    it("should transform incremental tool arguments to input_json_delta SSE", () => {
      // 1. Start chunk (ID/Name and empty object)
      const startChunk: StreamChunk = {
        type: "tool_call",
        delta: {
          toolCall: {
            id: "toolu_123",
            name: "get_weather",
            arguments: {}, // Empty object - will produce input_json_delta with {}
          },
        },
      };
      const startResult = transformStreamChunk(startChunk);
      const startOutput = Array.isArray(startResult)
        ? startResult.join("")
        : startResult;
      expect(startOutput).toContain("content_block_start");
      expect(startOutput).toContain("tool_use");
      // Empty object {} now also produces input_json_delta
      expect(startOutput).toContain("input_json_delta");

      // 2. Delta chunk (arguments string)
      const deltaChunk: StreamChunk = {
        type: "tool_call",
        delta: {
          toolCall: {
            id: "", // No ID in delta
            name: "",
            arguments: '{"location": "Seoul"}', // Incremental string
          },
        },
      };
      const deltaResult = transformStreamChunk(deltaChunk);
      expect(deltaResult).toContain("content_block_delta");
      expect(deltaResult).toContain("input_json_delta");
      expect(deltaResult).toContain('{\\"location\\": \\"Seoul\\"}');
    });

    it("should transform partialJson chunk to chunked input_json_delta SSE", () => {
      // Simulating a chunk with partialJson (as would come from parseStreamChunk)
      const partialJsonChunk: StreamChunk = {
        type: "tool_call",
        delta: {
          partialJson: '{"title": "Hello", "count": 42}', // Complete JSON string
        },
      };

      const result = transformStreamChunk(partialJsonChunk);
      const output = Array.isArray(result)
        ? result.join("")
        : result;

      // Should produce multiple input_json_delta events (chunked at 50 chars)
      expect(output).toContain("content_block_delta");
      expect(output).toContain("input_json_delta");
      expect(output).toContain('{\\"title\\": \\"Hello\\", \\"count\\": 42}');
    });

    it("should handle empty partialJson gracefully", () => {
      const emptyChunk: StreamChunk = {
        type: "tool_call",
        delta: {
          partialJson: "", // Empty JSON
        },
      };

      const result = transformStreamChunk(emptyChunk);
      expect(result).toBe("");
    });
  });

  describe("Stream parsing integration", () => {
    it("should handle a complete streaming conversation", () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", world!"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ];

      const chunks: StreamChunk[] = [];
      for (const sseData of sseChunks) {
        const chunk = parseStreamChunk(sseData);
        if (chunk) {
          chunks.push(chunk);
        }
      }

      // Should have: usage (message_start), 1x content (start), 2x content (text deltas), 1x block_stop, usage (message_delta), done
      expect(chunks.length).toBeGreaterThanOrEqual(6);

      // Check we got text content
      const textChunks = chunks.filter((c) => c.type === "content");
      // Now we expect 3 chunks: one from start (empty), two from deltas
      expect(textChunks.length).toBe(3);
      expect(textChunks[0]!.delta?.text).toBe("");
      expect(textChunks[1]!.delta?.text).toBe("Hello");
      expect(textChunks[2]!.delta?.text).toBe(", world!");

      // Check we got block_stop
      const blockStopChunk = chunks.find((c) => c.type === "block_stop");
      expect(blockStopChunk).toBeDefined();

      // Check we got done
      const doneChunk = chunks.find((c) => c.type === "done");
      expect(doneChunk).toBeDefined();
    });

    it("should handle thinking stream", () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgI"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my answer."}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":1}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ];

      const chunks: StreamChunk[] = [];
      for (const sseData of sseChunks) {
        const chunk = parseStreamChunk(sseData);
        if (chunk) {
          chunks.push(chunk);
        }
      }

      // Should have thinking chunks
      const thinkingChunks = chunks.filter((c) => c.type === "thinking");
      expect(thinkingChunks.length).toBeGreaterThanOrEqual(1);

      // Should have text content
      const textChunks = chunks.filter((c) => c.type === "content");
      expect(textChunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle tool use stream", () => {
      const sseChunks = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather","input":{}}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"loc"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ation\\": \\"NYC\\"}"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":30}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ];

      const chunks: StreamChunk[] = [];
      for (const sseData of sseChunks) {
        const chunk = parseStreamChunk(sseData);
        if (chunk) {
          chunks.push(chunk);
        }
      }

      // Should have tool_call chunks
      const toolChunks = chunks.filter((c) => c.type === "tool_call");
      expect(toolChunks.length).toBeGreaterThanOrEqual(1);

      // First tool chunk should have id and name
      expect(toolChunks[0]!.delta?.toolCall?.id).toBe("toolu_123");
      expect(toolChunks[0]!.delta?.toolCall?.name).toBe("get_weather");

      // Check stop reason
      const usageChunk = chunks.find((c) => c.stopReason === "tool_use");
      expect(usageChunk).toBeDefined();
      });

     it("should accumulate partialJson chunks to complete JSON", () => {
       const sseChunks = [
         `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"calculate","input":{}}}`,
         `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\": 10"}}`,
         `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":","}}`,
         `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":" \\"y\\": 20}"}}`,
       ];

       const chunks: StreamChunk[] = [];
       for (const sseData of sseChunks) {
         const chunk = parseStreamChunk(sseData);
         if (chunk) {
           chunks.push(chunk);
         }
       }

       // Should have: 1 tool_call with toolCall (from content_block_start)
       // + 3 tool_call chunks with partialJson
       const toolChunks = chunks.filter((c) => c.type === "tool_call");
       expect(toolChunks.length).toBe(4);

       // Accumulate partialJson
       let accumulated = "";
       for (const chunk of toolChunks) {
         if (chunk.delta?.partialJson) {
           accumulated += chunk.delta.partialJson;
         }
       }
       expect(accumulated).toBe('{"x": 10, "y": 20}');
     });

     it("should round-trip partialJson through unified format", () => {
       // 1. Parse Anthropic input_json_delta to unified partialJson
       const parseResult = parseStreamChunk(
         `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"key\\": \\"val"}}`
       );
       expect(parseResult?.delta?.partialJson).toBe('{"key": "val');

       // 2. Transform unified partialJson back to Anthropic input_json_delta
       const transformResult = transformStreamChunk({
         type: "tool_call",
         delta: {
           partialJson: '{"key": "val',
         },
       });

       const output = Array.isArray(transformResult)
         ? transformResult.join("")
         : transformResult;
       expect(output).toContain("input_json_delta");
       expect(output).toContain('{\\"key\\": \\"val');
     });

     it("should transform partialJson + toolCall to content_block_start + input_json_delta SSE", () => {
       // Bug fix: partialJson with toolCall metadata must send content_block_start first
       // This happens when OpenAI format is converted to Anthropic (e.g., OpenAI → Anthropic)
       const chunk: StreamChunk = {
         type: "tool_call",
         delta: {
           partialJson: '{"title": "Set Thread Title"}',
           toolCall: {
             id: "call_abc123xyz",
             name: "set_title",
             arguments: '{"title": "Set Thread Title"}',
           },
         },
       };

       const transformResult = transformStreamChunk(chunk);
       const output = Array.isArray(transformResult)
         ? transformResult.join("\n\n")
         : transformResult;

       // 1. Must include content_block_start with ID/Name
       expect(output).toContain("content_block_start");
       expect(output).toContain("tool_use");
       expect(output).toContain("call_abc123xyz");
       expect(output).toContain("set_title");

       // 2. Must also include input_json_delta with the partial JSON
       expect(output).toContain("input_json_delta");
       expect(output).toContain('{\\"title\\": \\"Set Thread Title\\"}');

       // 3. Verify it's an array (multiple events)
       expect(Array.isArray(transformResult)).toBe(true);
       if (Array.isArray(transformResult)) {
         // Should have at least: content_block_start + input_json_delta
         expect(transformResult.length).toBeGreaterThanOrEqual(2);
         // First event should be content_block_start
         expect(transformResult[0]).toContain("content_block_start");
       }
     });

     it("should handle large partialJson + toolCall properly chunked", () => {
       // Large JSON should be chunked into multiple input_json_delta events
       // while maintaining content_block_start first
       const largeJson = JSON.stringify({
         items: Array.from({ length: 10 }, (_, i) => ({
           id: `item_${i}`,
           name: `Item ${i}`,
           value: i * 100,
         })),
       });

       const chunk: StreamChunk = {
         type: "tool_call",
         delta: {
           partialJson: largeJson,
           toolCall: {
             id: "call_large_123",
             name: "process_items",
             arguments: largeJson,
           },
         },
       };

       const transformResult = transformStreamChunk(chunk);
       const events = Array.isArray(transformResult) ? transformResult : [transformResult];

       // First event must be content_block_start
       expect(events[0]).toContain("content_block_start");
       expect(events[0]).toContain("call_large_123");
       expect(events[0]).toContain("process_items");

       // Should have multiple events (content_block_start + multiple input_json_delta)
       expect(events.length).toBeGreaterThan(1);

       // Remaining events should all be input_json_delta
       for (let i = 1; i < events.length; i++) {
         expect(events[i]).toContain("input_json_delta");
       }
     });

     it("should handle toolCall without partialJson (fallback to normal mode)", () => {
       // When toolCall exists but partialJson is absent, use the normal tool_call path
       const chunk: StreamChunk = {
         type: "tool_call",
         delta: {
           toolCall: {
             id: "call_normal",
             name: "normal_tool",
             arguments: '{"key": "value"}',
           },
         },
       };

       const transformResult = transformStreamChunk(chunk);
       const output = Array.isArray(transformResult)
         ? transformResult.join("\n\n")
         : transformResult;

       // Should still have content_block_start + input_json_delta
       expect(output).toContain("content_block_start");
       expect(output).toContain("call_normal");
       expect(output).toContain("normal_tool");
       expect(output).toContain("input_json_delta");
       });

       it("should include input_tokens in usage chunk transformation (no stopReason → message_start)", () => {
        const chunk: StreamChunk = {
          type: "usage",
          usage: {
            inputTokens: 150,
            outputTokens: 50,
          },
        };

        const result = transformStreamChunk(chunk);
        // Without stopReason, returns single message_start string
        expect(typeof result).toBe("string");
        expect(result).toContain("event: message_start");
        expect(result).toContain('"input_tokens":150');
        expect(result).toContain('"output_tokens":50');
        });

        it("should return message_delta for usage chunk with stopReason", () => {
        const chunk: StreamChunk = {
          type: "usage",
          stopReason: "end_turn",
          usage: {
            inputTokens: 150,
            outputTokens: 50,
          },
        };

        const result = transformStreamChunk(chunk);
        // With stopReason, returns single message_delta string
        expect(typeof result).toBe("string");
        expect(result).toContain("event: message_delta");
        expect(result).toContain('"input_tokens":150');
        expect(result).toContain('"output_tokens":50');
        expect(result).toContain('"stop_reason":"end_turn"');
        });

       it("should include input_tokens in done chunk transformation", () => {
        const chunk: StreamChunk = {
          type: "done",
          stopReason: "end_turn",
          usage: {
            inputTokens: 200,
            outputTokens: 100,
          },
        };

        const result = transformStreamChunk(chunk);

        // result is array of strings for 'done' type
        const resultString = Array.isArray(result) ? result.join("\n") : result;

        expect(resultString).toContain('"input_tokens":200');
        expect(resultString).toContain('"output_tokens":100');
        });

        // Phase 2: message_start event generation tests (stopReason-based logic)
        describe("message_start event generation", () => {
          it("should return message_start for usage chunk without stopReason", () => {
            const chunk: StreamChunk = {
              type: "usage",
              usage: {
                inputTokens: 150,
                outputTokens: 50,
              },
            };

            const result = transformStreamChunk(chunk);

            // Without stopReason, returns single message_start string
            expect(typeof result).toBe("string");
            expect(result).toContain("event: message_start");
            expect(result).toContain('"type":"message_start"');
          });

          it("should return message_delta for usage chunk with stopReason", () => {
            const chunk: StreamChunk = {
              type: "usage",
              stopReason: "end_turn",
              usage: {
                inputTokens: 150,
                outputTokens: 50,
              },
            };

            const result = transformStreamChunk(chunk);

            // With stopReason, returns single message_delta string
            expect(typeof result).toBe("string");
            expect(result).toContain("event: message_delta");
            expect(result).toContain('"type":"message_delta"');
          });

          it("should include usage info in message_start.message.usage", () => {
            const chunk: StreamChunk = {
              type: "usage",
              usage: {
                inputTokens: 250,
                outputTokens: 75,
              },
            };

            const result = transformStreamChunk(chunk);
            expect(typeof result).toBe("string");
            
            const dataMatch = (result as string).match(/data: (.+)/);
            expect(dataMatch).not.toBeNull();
            const parsed = JSON.parse(dataMatch![1]!);
            
            expect(parsed.type).toBe("message_start");
            expect(parsed.message).toBeDefined();
            expect(parsed.message.usage).toBeDefined();
            expect(parsed.message.usage.input_tokens).toBe(250);
            expect(parsed.message.usage.output_tokens).toBe(75);
          });

          it("should include required message metadata in message_start", () => {
            const chunk: StreamChunk = {
              type: "usage",
              usage: {
                inputTokens: 100,
                outputTokens: 10,
              },
            };

            const result = transformStreamChunk(chunk);
            expect(typeof result).toBe("string");
            
            const dataMatch = (result as string).match(/data: (.+)/);
            const parsed = JSON.parse(dataMatch![1]!);
            
            // Required fields per Anthropic spec
            expect(parsed.message.id).toBeDefined();
            expect(parsed.message.type).toBe("message");
            expect(parsed.message.role).toBe("assistant");
            expect(parsed.message.model).toBeDefined();
            expect(parsed.message.content).toEqual([]);
          });

          it("should preserve cachedTokens in message_start usage", () => {
            const chunk: StreamChunk = {
              type: "usage",
              usage: {
                inputTokens: 500,
                outputTokens: 100,
                cachedTokens: 300,
              },
            };

            const result = transformStreamChunk(chunk);
            expect(typeof result).toBe("string");
            
            const dataMatch = (result as string).match(/data: (.+)/);
            const parsed = JSON.parse(dataMatch![1]!);
            
            // cachedTokens should map to cache_read_input_tokens
            expect(parsed.message.usage.cache_read_input_tokens).toBe(300);
          });

          it("should use provided model name in message_start", () => {
            const chunk: StreamChunk = {
              type: "usage",
              usage: {
                inputTokens: 100,
                outputTokens: 10,
              },
              model: "claude-3-opus-20240229",
            };

            const result = transformStreamChunk(chunk);
            expect(typeof result).toBe("string");
            
            const dataMatch = (result as string).match(/data: (.+)/);
            const parsed = JSON.parse(dataMatch![1]!);
            
            expect(parsed.message.model).toBe("claude-3-opus-20240229");
          });

          it("should fallback to default model name if not provided in message_start", () => {
            const chunk: StreamChunk = {
              type: "usage",
              usage: {
                inputTokens: 100,
                outputTokens: 10,
              },
            };

            const result = transformStreamChunk(chunk);
            expect(typeof result).toBe("string");
            
            const dataMatch = (result as string).match(/data: (.+)/);
            const parsed = JSON.parse(dataMatch![1]!);
            
            expect(parsed.message.model).toBe("claude-3-5-sonnet-20241022");
          });
        });
        });
        });
