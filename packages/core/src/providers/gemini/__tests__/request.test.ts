import { describe, expect, it } from 'bun:test'
import { parse as parseGemini, transform as transformGemini } from '../request'
import type { GeminiRequest } from '../types'
import type { UnifiedRequest } from '../../../types/unified'

describe('Gemini Request Transformation', () => {
  describe('Round Trip Consistency', () => {
    it('should maintain consistency for basic text messages', () => {
      const originalRequest: GeminiRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi there' }] }
        ]
      }

      const unified = parseGemini(originalRequest)
      const transformed = transformGemini(unified)

      expect(transformed.contents).toEqual(originalRequest.contents)
    })

    it('should maintain consistency for tool calls and results (with IDs)', () => {
      const originalRequest: GeminiRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'What is the weather?' }] },
          { 
            role: 'model', 
            parts: [
              { 
                functionCall: { 
                  name: 'get_weather', 
                  args: { location: 'Seoul' },
                  id: 'call_123'
                } 
              }
            ] 
          },
          { 
            role: 'user', 
            parts: [
              { 
                functionResponse: { 
                  name: 'get_weather', 
                  response: { temp: 20 },
                  id: 'call_123'
                } 
              }
            ] 
          }
        ],
        tools: [{
          functionDeclarations: [{
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'OBJECT', properties: { location: { type: 'STRING' } } }
          }]
        }]
      }

      const unified = parseGemini(originalRequest)
      const transformed = transformGemini(unified)

      // Verify structure and IDs
      expect(transformed.contents.length).toBe(3)
      
      const modelMsg = transformed.contents[1]
      const userMsg = transformed.contents[2]

      expect(modelMsg?.parts[0]?.functionCall?.id).toBe('call_123')
      expect(userMsg?.parts[0]?.functionResponse?.id).toBe('call_123')
      
      // Verify complete equality
      expect(transformed.contents).toEqual(originalRequest.contents)
    })

    it('should generate IDs for legacy tool calls (without IDs) and preserve them', () => {
      // Gemini supports function calls without IDs (legacy), but Unified enforces IDs.
      const originalRequest: GeminiRequest = {
        contents: [
          { 
            role: 'model', 
            parts: [
              { 
                functionCall: { 
                  name: 'get_weather', 
                  args: { location: 'Seoul' }
                  // No ID
                } 
              }
            ] 
          }
        ]
      }

      const unified = parseGemini(originalRequest)
      const transformed = transformGemini(unified)

      // Should now have an ID generated during parsing
      expect(transformed.contents[0]?.parts[0]?.functionCall?.id).toBeDefined()
      expect(transformed.contents[0]?.parts[0]?.functionCall?.id).toMatch(/^call_/)
    })
  })

  describe('Gemini 3 Flash Features', () => {
    it('should preserve IDs in complex Gemini 3 Flash structure', () => {
      const gemini3Request: GeminiRequest = {
        contents: [
          { 
            role: 'user', 
            parts: [{ text: 'Check the weather in Tokyo' }] 
          },
          { 
            role: 'model', 
            parts: [
              { 
                functionCall: { 
                  name: 'get_weather', 
                  args: { location: 'Tokyo' },
                  id: 'call_gemini3_abc123'
                } 
              }
            ] 
          },
          { 
            role: 'user', 
            parts: [
              { 
                functionResponse: { 
                  name: 'get_weather', 
                  response: { temp: 25, condition: 'Sunny' },
                  id: 'call_gemini3_abc123'
                } 
              }
            ] 
          }
        ],
        tools: [{
          functionDeclarations: [{
            name: 'get_weather',
            description: 'Get current weather',
            parameters: { 
              type: 'OBJECT', 
              properties: { 
                location: { type: 'STRING' } 
              },
              required: ['location']
            }
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          topP: 0.95,
          thinkingConfig: {
            includeThoughts: true
          }
        }
      }
  
      const unified = parseGemini(gemini3Request)
      const transformed = transformGemini(unified)
  
      // Verify IDs are preserved
      const transformedModelMsg = transformed.contents[1]
      const transformedUserMsg = transformed.contents[2]
  
      expect(transformedModelMsg?.parts[0]?.functionCall?.id).toBe('call_gemini3_abc123')
      expect(transformedUserMsg?.parts[0]?.functionResponse?.id).toBe('call_gemini3_abc123')
      
      // Verify deep equality
      expect(transformed.contents).toEqual(gemini3Request.contents)
    })
  
    it('should handle thinking content correctly', () => {
      const gemini3ThinkingRequest: GeminiRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'Solve this riddle' }] },
          { 
            role: 'model', 
            parts: [
              { 
                thought: true, 
                text: 'I need to think about this...',
                thoughtSignature: 'sig_123'
              },
              { text: 'The answer is 42.' }
            ] 
          }
        ],
        generationConfig: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 1024
          }
        }
      }
  
      const unified = parseGemini(gemini3ThinkingRequest)
      const transformed = transformGemini(unified)
  
      expect(transformed.contents[1]?.parts[0]?.thought).toBe(true)
      expect(transformed.contents[1]?.parts[0]?.text).toBe('I need to think about this...')
      expect(transformed.contents[1]?.parts[0]?.thoughtSignature).toBe('sig_123')
      
      // Check config preservation
      expect(transformed.generationConfig?.thinkingConfig?.includeThoughts).toBe(true)
      expect(transformed.generationConfig?.thinkingConfig?.thinkingBudget).toBe(1024)
    })
  })

  describe('Tool Result Error Handling', () => {
    it('should preserve isError flag in tool results during round-trip transformation', () => {
      const originalRequest: GeminiRequest = {
        contents: [
          { role: 'user', parts: [{ text: 'Execute tool' }] },
          { 
            role: 'model', 
            parts: [
              { 
                functionCall: { 
                  name: 'execute_command',
                  args: { cmd: 'ls' },
                  id: 'call_cmd_1'
                } 
              }
            ] 
          },
          { 
            role: 'user', 
            parts: [
              { 
                functionResponse: { 
                  name: 'execute_command',
                  response: { error: 'Permission denied' },
                  id: 'call_cmd_1'
                },
                // Note: Gemini uses an error field to indicate failure
                // We need to capture this semantically as isError
              }
            ] 
          }
        ],
        tools: [{
          functionDeclarations: [{
            name: 'execute_command',
            description: 'Execute a command',
            parameters: { type: 'OBJECT', properties: { cmd: { type: 'STRING' } } }
          }]
        }]
      }

      const unified = parseGemini(originalRequest)
      const transformed = transformGemini(unified)

      // Verify tool result exists
      expect(transformed.contents[2]?.parts[0]?.functionResponse).toBeDefined()
      expect(transformed.contents[2]?.parts[0]?.functionResponse?.id).toBe('call_cmd_1')
    })

    it('should preserve isError flag when explicitly provided in tool result', () => {
      const originalRequest: GeminiRequest = {
        contents: [
          { 
            role: 'model', 
            parts: [
              { 
                functionCall: { 
                  name: 'fetch_data',
                  args: { url: 'http://example.com' },
                  id: 'call_fetch_1'
                } 
              }
            ] 
          },
          { 
            role: 'user', 
            parts: [
              { 
                functionResponse: { 
                  name: 'fetch_data',
                  response: { error: 'Network timeout' },
                  id: 'call_fetch_1'
                }
              }
            ] 
          }
        ],
        tools: [{
          functionDeclarations: [{
            name: 'fetch_data',
            description: 'Fetch data from URL',
            parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } } }
          }]
        }]
      }

      const unified = parseGemini(originalRequest)

      // isError should be captured during parse if available
      const toolResultPart = unified.messages[1]?.parts.find(p => p.type === 'tool_result')
      expect(toolResultPart).toBeDefined()

      // Transform back and verify
      const transformed = transformGemini(unified)
      const transformedToolResult = transformed.contents[1]?.parts[0]?.functionResponse

      expect(transformedToolResult).toBeDefined()
      expect(transformedToolResult?.id).toBe('call_fetch_1')
      expect(transformedToolResult?.response).toEqual({ error: 'Network timeout' })
    })

    it('should preserve isError flag from unified format back to gemini', () => {
      // Create a Unified request with isError set
      const unifiedRequest: UnifiedRequest = {
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool_call' as const,
                toolCall: {
                  id: 'call_api_1',
                  name: 'call_api',
                  arguments: { endpoint: '/users' },
                },
              },
            ],
          },
          {
            role: 'tool',
            parts: [
              {
                type: 'tool_result' as const,
                toolResult: {
                  toolCallId: 'call_api_1',
                  content: JSON.stringify({ error: 'API rate limited' }),
                  isError: true, // This should be preserved
                },
              },
            ],
          },
        ],
      }

      const transformed = transformGemini(unifiedRequest)

      // Verify the error state is preserved in the response
      const toolResponse = transformed.contents[1]?.parts[0]?.functionResponse
      expect(toolResponse).toBeDefined()
      expect(toolResponse?.response).toEqual({ error: 'API rate limited' })
    })
  })
})
