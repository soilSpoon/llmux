import { describe, expect, test } from 'bun:test'
import { parseResponse, transformResponse } from '../../src/formats/openai-responses/response'
import type { ResponsesResponse } from '../../src/formats/openai-responses/types'

// Real capture from upstream.txt
// Note: instructions field is truncated for brevity but functionality remains the same
const UPSTREAM_CAPTURE_RESPONSE = {
  "id": "resp_01b277e0e5361695016960c55dae3481918151218f2bc8f83e",
  "object": "response",
  "created_at": 1767949661,
  "status": "in_progress",
  "background": false,
  "completed_at": null,
  "error": null,
  "incomplete_details": null,
  "instructions": "You are GPT-5.1 running in the Codex CLI..."
} as ResponsesResponse

// Real capture from translated.txt (what we currently produce, approximately)
// This represents the state we are trying to fix/align with upstream
const TRANSLATED_CAPTURE_RESPONSE = {
  "id": "resp_0df65176f2b0a8b4016960c63706508191b5f40b9b4b3e1e0c",
  "object": "response",
  "status": "in_progress",
  "created_at": 1767949879,
  "model": "gpt-5.1-2025-11-13", // Extra field not in upstream?
  "instructions": "You are GPT-5.1 running in the Codex CLI..."
  // Missing: background, completed_at, error, incomplete_details
} as any

describe('OpenAI Responses Roundtrip (Real Capture)', () => {
  
  test('upstream response.created should roundtrip with all null/default fields', () => {
    // 1. Parse the upstream capture
    const parsed = parseResponse(UPSTREAM_CAPTURE_RESPONSE)
    
    // 2. Transform it back
    const reconstructed = transformResponse(parsed)
    
    // 3. Verify exact field match
    // We want to ensure we preserve/generate the fields that upstream sends
    
    // Check specific fields that were missing in translated.txt
    expect(reconstructed.background).toBe(UPSTREAM_CAPTURE_RESPONSE.background)
    expect(reconstructed.completed_at).toBe(UPSTREAM_CAPTURE_RESPONSE.completed_at)
    expect(reconstructed.error).toBe(UPSTREAM_CAPTURE_RESPONSE.error)
    expect(reconstructed.incomplete_details).toBe(UPSTREAM_CAPTURE_RESPONSE.incomplete_details)
    
    // Check general structure
    expect(reconstructed.id).toBe(UPSTREAM_CAPTURE_RESPONSE.id)
    expect(reconstructed.object).toBe('response')
    expect(reconstructed.status).toBe('in_progress')
    
    // Model field check: Upstream didn't have it in the snippet, but our transformer might add it?
    // If upstream capture has no model, parsed metadata might have undefined model.
    // Transform usually puts model if available.
    // Let's see what happens.
  })
  
  test('should handle background field specifically', () => {
    // This seems to be one of the missing fields
    const parsed = parseResponse(UPSTREAM_CAPTURE_RESPONSE)
    expect(parsed.background).toBe(false)
    
    const reconstructed = transformResponse(parsed)
    expect(reconstructed.background).toBe(false)
  })

  test('should handle null fields specifically', () => {
    const parsed = parseResponse(UPSTREAM_CAPTURE_RESPONSE)
    // Verify parse preserves these as null or undefined in metadata
    // (Assuming ResponseMetadata has these fields)
    
    const reconstructed = transformResponse(parsed)
    expect(reconstructed.completed_at).toBeNull()
    expect(reconstructed.error).toBeNull()
    expect(reconstructed.incomplete_details).toBeNull()
  })

})
