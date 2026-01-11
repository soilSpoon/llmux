import { describe, it, expect } from "bun:test";
import { parseStreamChunk } from "../src/formats/openai-responses/streaming";
import { StreamChunk } from "../src/types/unified";

import { ResponsesOutputItem } from "../src/formats/openai-responses/types";

describe("OpenAI Responses Full Stream Accumulation", () => {
  it("should accumulate content correctly without duplication when receiving response.completed", () => {
    // 1. 시뮬레이션할 SSE 이벤트들 (델타 + 최종 완료)
    const events = [
      // 첫 번째 텍스트 조각
      {
        event: "response.output_text.delta",
        data: JSON.stringify({
          type: "response.output_text.delta",
          response_id: "resp_1",
          output_index: 0,
          item_id: "msg_1",
          content_index: 0,
          delta: "Hello",
        }),
      },
      // 두 번째 텍스트 조각
      {
        event: "response.output_text.delta",
        data: JSON.stringify({
          type: "response.output_text.delta",
          response_id: "resp_1",
          output_index: 0,
          item_id: "msg_1",
          content_index: 0,
          delta: " World",
        }),
      },
      // 최종 완료 이벤트 (전체 텍스트 "Hello World"를 포함)
      {
        event: "response.completed",
        data: JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "completed",
            output: [
              {
                id: "msg_1",
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Hello World",
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 5,
              output_tokens: 10,
              total_tokens: 15,
            },
          },
        }),
      },
    ];

    const allChunks: StreamChunk[] = [];

    // 2. 모든 SSE 이벤트를 순차적으로 파싱
    for (const event of events) {
      const sseLine = `data: ${event.data}`;
      const result = parseStreamChunk(sseLine);
      if (result) {
        if (Array.isArray(result)) {
          allChunks.push(...result);
        } else {
          allChunks.push(result as StreamChunk);
        }
      }
    }

    // 3. 누적된 결과 검증
    const contentChunks = allChunks.filter((c) => c.type === "content");
    
    // 델타 조각들 ("Hello", " World") 만 있어야 함.
    // response.completed에서 생성된 중복 "Hello World"가 없어야 함.
    expect(contentChunks.length).toBe(2);
    
    const fullText = contentChunks
      .map((c) => {
        if (c.type === "content" && c.delta?.text) {
          return c.delta.text;
        }
        return "";
      })
      .join("");
    
    expect(fullText).toBe("Hello World");

    // 4. Usage 및 Done 청크 확인
    const usageChunk = allChunks.find((c) => c.type === "usage");
    expect(usageChunk).toBeDefined();
    
    const doneChunk = allChunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
    
    // doneChunk의 responseMetadata에 전체 output이 잘 보존되어 있는지 확인 (라운드트립용)
    const meta = doneChunk?.responseMetadata;
    expect(meta?.output).toBeDefined();
    
    // meta.output이 존재하는 것이 확인되었으므로 구조를 검증
    const output = meta?.output as ResponsesOutputItem[] | undefined;
    if (output && output.length > 0) {
      const firstItem = output[0];
      if (firstItem) {
        expect(firstItem.content?.[0]?.text).toBe("Hello World");
      }
    } else {
      throw new Error("Expected output array to be present and non-empty");
    }
  });
});
