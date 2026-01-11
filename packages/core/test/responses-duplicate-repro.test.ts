import { describe, it, expect } from "bun:test";
import { parseStreamChunk } from "../src/formats/openai-responses/streaming";
import { StreamChunk } from "../src/types/unified";

describe("OpenAI Responses Streaming Duplication Repro", () => {
  it("should not emit content chunks when processing response.completed in streaming mode", () => {
    const completedEvent = {
      event: "response.completed",
      data: JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_123",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "Hello, this is a completed message.",
                },
              ],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
          },
        },
      }),
    };

    const sseLine = `data: ${completedEvent.data}`;
    const result = parseStreamChunk(sseLine);

    expect(result).not.toBeNull();
    const chunks = Array.isArray(result) ? result : [result as StreamChunk];

    // streaming 모드에서 response.completed를 받으면 usage와 done 청크만 있어야 함.
    // 기존 버그는 여기에 'content' 타입의 청크를 추가로 생성하여 중복 응답을 발생시킴.
    const contentChunks = chunks.filter((c) => c.type === "content");
    
    // 이 부분에서 실패해야 함 (기존 버그는 contentChunks.length === 1)
    expect(contentChunks.length).toBe(0);
    
    const usageChunk = chunks.find((c) => c.type === "usage");
    expect(usageChunk).toBeDefined();
    
    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
    expect(doneChunk?.stopReason).toBe("end_turn");
  });
});
