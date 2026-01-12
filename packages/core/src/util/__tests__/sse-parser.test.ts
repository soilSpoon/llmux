import { describe, expect, it } from "bun:test";
import { SSEParser } from "../sse-parser";

describe("SSEParser", () => {
  it("should parse multiple data lines", () => {
    const parser = new SSEParser();
    const chunk = new TextEncoder().encode(
      'data: {"id": "1"}\n\ndata: {"id": "2"}\n'
    );
    const results = parser.push(chunk);
    expect(results).toEqual(['{"id": "1"}', '{"id": "2"}']);
  });

  it("should handle partial lines across chunks", () => {
    const parser = new SSEParser();
    const chunk1 = new TextEncoder().encode('data: {"id": ');
    const chunk2 = new TextEncoder().encode('"1"}\n');
    
    expect(parser.push(chunk1)).toEqual([]);
    expect(parser.push(chunk2)).toEqual(['{"id": "1"}']);
  });

  it("should handle multibyte characters split across chunks", () => {
    const parser = new SSEParser();
    const text = 'data: {"text": "안녕하세요"}\n';
    const encoded = new TextEncoder().encode(text);
    
    // Split in the middle of a multibyte character (UTF-8 for '하' is 0xED 0x95 0x98)
    // "안녕하세요" in UTF-8:
    // 안: EC 95 88
    // 녕: EB 85 95
    // 하: ED 95 98
    // 세: EC 84 B8
    // 요: EC 9A 94
    
    const splitIndex = 15; // Somewhere in the middle of '안녕하세요'
    const chunk1 = encoded.slice(0, splitIndex);
    const chunk2 = encoded.slice(splitIndex);
    
    expect(parser.push(chunk1)).toEqual([]);
    const results = parser.push(chunk2);
    expect(results).toEqual(['{"text": "안녕하세요"}']);
  });

  it("should handle multibyte characters split across chunks (precise byte split)", () => {
    const parser = new SSEParser();
    // '한' in UTF-8: ED 95 9C (3 bytes)
    const text = 'data: 한\n';
    const encoded = new TextEncoder().encode(text);
    
    // Split '한' (ED 95 9C) after the first byte (ED)
    // "data: " is 6 bytes.
    // Index 6 is ED.
    const chunk1 = encoded.slice(0, 7); // "data: " + ED
    const chunk2 = encoded.slice(7);    // 95 9C + "\n"
    
    const res1 = parser.push(chunk1);
    expect(res1).toEqual([]);
    
    const res2 = parser.push(chunk2);
    expect(res2).toEqual(['한']);
  });

  it("should ignore [DONE] signal", () => {
    const parser = new SSEParser();
    const chunk = new TextEncoder().encode('data: {"id": "1"}\ndata: [DONE]\n');
    const results = parser.push(chunk);
    expect(results).toEqual(['{"id": "1"}']);
  });

  it("should handle flush for remaining data", () => {
    const parser = new SSEParser();
    const chunk = new TextEncoder().encode('data: {"id": "1"}');
    expect(parser.push(chunk)).toEqual([]);
    const results = parser.flush();
    expect(results).toEqual(['{"id": "1"}']);
  });
});
