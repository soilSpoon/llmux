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

  it("should handle 4-byte emoji split across chunks", () => {
    const parser = new SSEParser();
    // 🎉 emoji: F0 9F 8E 89 (4 bytes)
    const text = 'data: {"emoji": "🎉"}\n';
    const encoded = new TextEncoder().encode(text);
    
    // Split after first 2 bytes of the emoji
    const emojiStart = text.indexOf("🎉");
    const byteOffset = new TextEncoder().encode(text.slice(0, emojiStart)).length;
    const chunk1 = encoded.slice(0, byteOffset + 2); // F0 9F
    const chunk2 = encoded.slice(byteOffset + 2);    // 8E 89 + rest
    
    expect(parser.push(chunk1)).toEqual([]);
    expect(parser.push(chunk2)).toEqual(['{"emoji": "🎉"}']);
  });

  it("should handle multiple multibyte splits in sequence", () => {
    const parser = new SSEParser();
    const text = 'data: 가나다\n';
    const encoded = new TextEncoder().encode(text);
    
    // Split each character: 가(3 bytes) 나(3 bytes) 다(3 bytes)
    // "data: " = 6 bytes
    const chunk1 = encoded.slice(0, 8);  // "data: " + 가[0..1]
    const chunk2 = encoded.slice(8, 11); // 가[2] + 나[0..1]
    const chunk3 = encoded.slice(11);    // 나[2] + 다 + \n
    
    expect(parser.push(chunk1)).toEqual([]);
    expect(parser.push(chunk2)).toEqual([]);
    expect(parser.push(chunk3)).toEqual(['가나다']);
  });

  it("should handle CRLF line endings with multibyte", () => {
    const parser = new SSEParser();
    const chunk = new TextEncoder().encode('data: 日本語\r\ndata: 中文\r\n');
    const results = parser.push(chunk);
    expect(results).toEqual(['日本語', '中文']);
  });

  it("should handle flush with incomplete multibyte at stream end", () => {
    const parser = new SSEParser();
    const text = 'data: テスト';
    const encoded = new TextEncoder().encode(text);
    
    // Push incomplete - missing newline
    expect(parser.push(encoded)).toEqual([]);
    expect(parser.flush()).toEqual(['テスト']);
  });

  it("should handle mixed ASCII and multibyte in same chunk", () => {
    const parser = new SSEParser();
    const chunk = new TextEncoder().encode(
      'data: {"en": "hello", "ko": "안녕", "jp": "こんにちは"}\n'
    );
    expect(parser.push(chunk)).toEqual([
      '{"en": "hello", "ko": "안녕", "jp": "こんにちは"}'
    ]);
  });
});
