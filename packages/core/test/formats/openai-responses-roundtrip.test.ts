import { describe, expect, test } from 'bun:test'
import { parseResponse, transformResponse } from '../../src/formats/openai-responses/response'
import { OpenAIResponsesStreamingBuilder } from '../../src/formats/openai-responses/streaming-builder'
import type { ResponsesResponse } from '../../src/formats/openai-responses/types'
import type { StreamChunk } from '../../src/types/unified'

// Mock of a capture file like a.txt
// Contains a single response.created event payload (JSON)
const CAPTURED_RESPONSE_CREATED: ResponsesResponse = {
  id: "resp_019ba1df-8526-7788-b4b9-8e411516766d",
  object: "response",
  created_at: 1736458023,
  model: "claude-3-5-sonnet-20241022",
  status: "in_progress",
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather in a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" }
          },
          required: ["location"]
        }
      }
    }
  ],
  obfuscation: true
}

describe('OpenAI Responses Roundtrip (a.txt simulation)', () => {
  // TDD: This test verifies that we can roundtrip a captured response.created event
  // through our parse -> transform pipeline and get back the exact same structure.
  // Currently expected to fail if our transform implementation is missing fields 
  // or formatting present in the capture.
  
  test('response.created should roundtrip correctly', () => {
    // 1. Parse the captured event (simulating receiving it)
    // The capture is specifically the "response" object inside the response.created event data
    const parsed = parseResponse(CAPTURED_RESPONSE_CREATED)
    
    // 2. Transform it back (simulating sending it out via builder or transformResponse)
    // We use transformResponse here as it's the direct counterpart to parseResponse
    const reconstructed = transformResponse(parsed)
    
    // 3. Verify all fields match the original capture
    // Check specific critical fields first for better error messages
    expect(reconstructed.id).toBe(CAPTURED_RESPONSE_CREATED.id)
    expect(reconstructed.model).toBe(CAPTURED_RESPONSE_CREATED.model)
    // expect(reconstructed.created_at).toBe(CAPTURED_RESPONSE_CREATED.created_at) // This might fail if types are loose
    expect(reconstructed.object).toBe(CAPTURED_RESPONSE_CREATED.object)
    
    // Deep equality check
    // We expect this to FAIL initially because:
    // 1. transformResponse might not include 'created_at' (commented out in source)
    // 2. transformResponse might add default 'output: []' which might not be in the minimal capture
    // 3. transformResponse might defaults status to 'completed' if stopReason is missing/null, 
    //    whereas capture has 'in_progress'
    expect(reconstructed).toEqual(expect.objectContaining(CAPTURED_RESPONSE_CREATED))
  })
  
  // Also verify streaming builder behavior matches expectation if we were to simulate it
  test('streaming builder should produce matching response.created structure', () => {
    const builder = new OpenAIResponsesStreamingBuilder(CAPTURED_RESPONSE_CREATED.model)
    if (CAPTURED_RESPONSE_CREATED.id) {
      builder.setOriginalResponseId(CAPTURED_RESPONSE_CREATED.id)
    }
    
    // Trigger the first event
    const events = builder.build({ 
      type: 'content', 
      delta: { type: 'text', text: 'Start' },
      // Inject metadata to control created_at if possible, 
      // though builder defaults to Date.now()
      responseMetadata: {
        createdAt: CAPTURED_RESPONSE_CREATED.created_at,
        tools: CAPTURED_RESPONSE_CREATED.tools,
        obfuscation: CAPTURED_RESPONSE_CREATED.obfuscation
      }
    } as StreamChunk)
    
    const createdEvent = events.find(e => e.includes('"type":"response.created"'))
    expect(createdEvent).toBeDefined()
    
    const dataMatch = createdEvent!.match(/data: (.+)/)
    const eventData = JSON.parse(dataMatch![1]!)
    
    // The inner response object
    const responseObj = eventData.response
    
    expect(responseObj.id).toBe(CAPTURED_RESPONSE_CREATED.id)
    expect(responseObj.model).toBe(CAPTURED_RESPONSE_CREATED.model)
    expect(responseObj.created_at).toBe(CAPTURED_RESPONSE_CREATED.created_at)
    expect(responseObj.status).toBe('in_progress')
    
    // Verify tools field if it's required (it is in the capture)
    expect(responseObj.tools).toBeDefined()
    expect(responseObj.tools).toHaveLength(1)
    expect(responseObj.tools[0].type).toBe('function')
    
    // Verify obfuscation
    expect(responseObj.obfuscation).toBe(true)
  })
})
