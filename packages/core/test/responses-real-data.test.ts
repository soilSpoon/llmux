
import { describe, expect, test } from 'bun:test'
import { parseStreamChunk } from '../../core/src/formats/openai-responses/streaming'
import { OpenAIResponsesStreamingBuilder } from '../../core/src/formats/openai-responses/streaming-builder'

const REAL_DATA = `event: response.created
data: {"type":"response.created","response":{"id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","object":"response","status":"in_progress","created_at":1767935900,"model":"gpt-5.1-2025-11-13"}}

event: response.in_progress
data: {"type":"response.in_progress","response":{"id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","object":"response","status":"in_progress","created_at":1767935900,"model":"gpt-5.1-2025-11-13"}}

event: response.output_item.added
data: {"type":"response.output_item.added","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item":{"id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","type":"reasoning"}}

event: response.reasoning_summary_part.added
data: {"type":"response.reasoning_summary_part.added","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item_id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","part":{"type":"summary_text","text":""}}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item_id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","summary_index":0,"delta":"OpenAI"}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item_id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","summary_index":0,"delta":" has"}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item_id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","summary_index":0,"delta":" not"}

event: response.reasoning_summary_text.done
data: {"type":"response.reasoning_summary_text.done","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item_id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","text":"OpenAI has not"}

event: response.reasoning_summary_part.done
data: {"type":"response.reasoning_summary_part.done","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item_id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78"}

event: response.output_item.done
data: {"type":"response.output_item.done","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":0,"item":{"id":"rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78","type":"reasoning","status":"completed","summary":[{"type":"summary_text","text":"OpenAI has not"}]}}

event: response.output_item.added
data: {"type":"response.output_item.added","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":1,"item":{"id":"msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","type":"message","role":"assistant","content":[{"type":"output_text","text":""}]}}

event: response.content_part.added
data: {"type":"response.content_part.added","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":1,"item_id":"msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","content_index":0,"part":{"type":"output_text","text":""}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":1,"item_id":"msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","content_index":0,"delta":"Hello"}

event: response.output_text.done
data: {"type":"response.output_text.done","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":1,"item_id":"msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","content_index":0,"text":"Hello"}

event: response.content_part.done
data: {"type":"response.content_part.done","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":1,"item_id":"msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","content_index":0}

event: response.output_item.done
data: {"type":"response.output_item.done","response_id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","output_index":1,"item":{"id":"msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hello"}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e","object":"response","status":"completed","created_at":1767935900,"model":"gpt-5.1-2025-11-13","usage":{"input_tokens":10,"output_tokens":25,"total_tokens":35}}}
`

describe('OpenAI Responses Real Data Roundtrip', () => {
  test('should process real world trace correctly', () => {
    // 1. Split raw data into chunks
    const rawChunks = REAL_DATA.split('\n\n').filter(c => c.trim().length > 0);
    
    // 2. Parse chunks into unified StreamChunks
    const parsedChunks = [];
    for (const rawChunk of rawChunks) {
      const parsed = parseStreamChunk(rawChunk);
      if (parsed) {
        if (Array.isArray(parsed)) {
          parsedChunks.push(...parsed);
        } else {
          parsedChunks.push(parsed);
        }
      }
    }
    
    // 3. Rebuild chunks into SSE events
    const builder = new OpenAIResponsesStreamingBuilder();
    const outputEvents = [];
    
    for (const chunk of parsedChunks) {
      const events = builder.build(chunk);
      outputEvents.push(...events);
    }
    
    const finalEvents = builder.flush();
    outputEvents.push(...finalEvents);
    
    // 4. Verify structural integrity and content
    // Check IDs
    const responseId = 'resp_0992cccae6a7c9670169608f9c224c81919211350a31ba796e';
    const reasoningId = 'rs_0992cccae6a7c9670169608f9d4650819193bf80a4449a4b78';
    const messageId = 'msg_0992cccae6a7c9670169608f9c224c81919211350a31ba796e';
    
    // Check created/in_progress presence
    const created = outputEvents.find(e => e.includes('response.created'));
    const inProgress = outputEvents.find(e => e.includes('response.in_progress'));
    
    expect(created).toBeDefined();
    expect(inProgress).toBeDefined();
    expect(created).toContain(responseId);
    expect(inProgress).toContain(responseId);
    
    // Check reasoning items
    const reasoningAdded = outputEvents.find(e => e.includes('response.output_item.added') && e.includes('reasoning'));
    expect(reasoningAdded).toContain(reasoningId);
    
    const reasoningPartAdded = outputEvents.find(e => e.includes('response.reasoning_summary_part.added'));
    expect(reasoningPartAdded).toContain(reasoningId);
    
    // Check deltas
    const deltas = outputEvents.filter(e => e.includes('response.reasoning_summary_text.delta'));
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0]).toContain('OpenAI');
    
    // Check done events for reasoning
    const reasoningTextDone = outputEvents.find(e => e.includes('response.reasoning_summary_text.done'));
    expect(reasoningTextDone).toBeDefined();
    
    const reasoningPartDone = outputEvents.find(e => e.includes('response.reasoning_summary_part.done'));
    expect(reasoningPartDone).toBeDefined();
    
    const outputItemDoneReasoning = outputEvents.find(e => e.includes('response.output_item.done') && e.includes('reasoning'));
    expect(outputItemDoneReasoning).toBeDefined();
    expect(outputItemDoneReasoning).toContain(reasoningId);
    
    // Check message items
    const messageAdded = outputEvents.find(e => e.includes('response.output_item.added') && e.includes('message'));
    expect(messageAdded).toContain(messageId);
    
    const contentPartAdded = outputEvents.find(e => e.includes('response.content_part.added'));
    expect(contentPartAdded).toContain(messageId);
    
    const msgDeltas = outputEvents.filter(e => e.includes('response.output_text.delta'));
    expect(msgDeltas.length).toBeGreaterThan(0);
    expect(msgDeltas[0]).toContain('Hello');
    
    // Check completed
    const completed = outputEvents.find(e => e.includes('response.completed'));
    expect(completed).toBeDefined();
    expect(completed).toContain('"input_tokens":10');
    expect(completed).toContain('"output_tokens":25');
  });
});
