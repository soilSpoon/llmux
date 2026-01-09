/**
 * Google Gemini API wire format fixtures
 */

export const GoogleGeminiFixtures = {
  requests: {
    simple: {
      contents: [{ role: 'user', parts: [{ text: 'Hello, world!' }] }],
    },
    withSystem: {
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
    },
    withToolCall: {
      contents: [
        { role: 'user', parts: [{ text: 'What is the weather?' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_weather',
                args: { location: 'NYC', unit: 'celsius' },
              },
            },
          ],
        },
      ],
    },
    withToolResult: {
      contents: [
        { role: 'user', parts: [{ text: 'What is the weather?' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_weather',
                args: { location: 'NYC' },
              },
            },
          ],
        },
        {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'get_weather',
                response: { name: 'get_weather', content: { temperature: 72, condition: 'sunny' } },
              },
            },
          ],
        },
      ],
    },
    // Test case: tool result with array response (should be wrapped in object)
    withToolResultArrayResponse: {
      contents: [
        { role: 'user', parts: [{ text: 'List files' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'list_files',
                args: { dir: '/tmp' },
                id: 'call_123',
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'list_files',
                response: { result: ['file1.txt', 'file2.txt', 'file3.txt'] },
                id: 'call_123',
              },
            },
          ],
        },
      ],
    },
    // Test case: functionResponse with empty name AND empty id (real AMP scenario)
    // This simulates the actual case where the client sends functionResponse without name or id
    // The system should match by index/order
    withToolResultEmptyNameNoId: {
      contents: [
        { role: 'user', parts: [{ text: 'Read file' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'Read',
                args: { path: '/Users/dh/Sites/wn' },
                id: 'resp_ol6grd06d',
              },
            },
            {
              functionCall: {
                name: 'glob',
                args: { filePattern: 'package.json' },
                id: 'resp_qdf9snrh3',
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: '', // Empty name AND no id - must match by position
                response: { output: { content: 'file contents' } },
                // No id field!
              },
            },
            {
              functionResponse: {
                name: '', // Empty name AND no id - must match by position
                response: { output: ['package.json'] },
                // No id field!
              },
            },
          ],
        },
      ],
    },
    // Test case: functionResponse with empty name (should resolve from functionCall.id)
    // This simulates the case where the client sends functionResponse without name
    withToolResultEmptyName: {
      contents: [
        { role: 'user', parts: [{ text: 'Read file' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'Read',
                args: { path: '/Users/dh/Sites/wn' },
                id: 'resp_ol6grd06d',
              },
            },
            {
              functionCall: {
                name: 'glob',
                args: { filePattern: 'package.json' },
                id: 'resp_qdf9snrh3',
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: '', // Empty name - should be resolved from functionCall
                response: { output: { content: 'file contents' } },
                id: 'resp_ol6grd06d',
              },
            },
            {
              functionResponse: {
                name: '', // Empty name - should be resolved from functionCall
                response: { output: ['package.json'] },
                id: 'resp_qdf9snrh3',
              },
            },
          ],
        },
      ],
    },
    // Test case: functionResponse without id, only with name (legacy format)
    withToolResultNoId: {
      contents: [
        { role: 'user', parts: [{ text: 'Get weather' }] },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_weather',
                args: { location: 'NYC' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_weather',
                response: { temperature: 72 },
              },
            },
          ],
        },
      ],
    },
    withConfig: {
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ['STOP', 'END'],
      },
    },
    withTools: {
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Get weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                  unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
                },
                required: ['location'],
              },
            },
          ],
        },
      ],
    },
    multipartContent: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'What is in this image?' },
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
      ],
    },
  },

  responses: {
    simple: {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'Hello! How can I help you today?' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    },
    withToolCall: {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'get_weather',
                  args: { location: 'NYC', unit: 'celsius' },
                },
              },
            ],
          },
          finishReason: 'STOP', // Gemini sometimes uses STOP for tool calls
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 25,
        totalTokenCount: 40,
      },
    },
    multipleToolCalls: {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'Checking both locations.' },
              {
                functionCall: {
                  name: 'get_weather',
                  args: { location: 'NYC' },
                },
              },
              {
                functionCall: {
                  name: 'get_weather',
                  args: { location: 'LA' },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    },
    maxTokens: {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'This response was truncated...' }] },
          finishReason: 'MAX_TOKENS',
        },
      ],
    },
  },

  streaming: {
    chunks: [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}]}',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}',
    ],
    toolCallChunks: [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"location":"NYC"}}}]}}]}',
      'data: {"candidates":[{"finishReason":"STOP"}]}',
    ],
    // Test case: thinking + functionCall in same chunk (Gemini 3 extended thinking with tool use)
    thinkingWithToolCallChunks: [
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"**Defining the Task Scope**\\n\\nI\'m currently focused on defining the initial task for the `oracle` tool."}]}}],"usageMetadata":{"trafficType":"PROVISIONED_THROUGHPUT"},"modelVersion":"gemini-3-pro-preview","createTime":"2026-01-08T07:16:14.009736Z","responseId":"vllfaYhM74mu2g_AturJDA"},"traceId":"9214cbdcd20ce8b9"}',
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thoughtSignature":"CiQBjz1rX5YuVoN5...","functionCall":{"name":"oracle","args":{"task":"Analyze the project"}}}]}}],"usageMetadata":{"promptTokenCount":14958,"candidatesTokenCount":41,"totalTokenCount":15119,"trafficType":"PROVISIONED_THROUGHPUT"},"modelVersion":"gemini-3-pro-preview","createTime":"2026-01-08T07:16:14.009736Z","responseId":"vllfaYhM74mu2g_AturJDA"},"traceId":"9214cbdcd20ce8b9"}',
      'data: {"response":{"candidates":[{"finishReason":"STOP"}]},"traceId":"9214cbdcd20ce8b9"}',
    ],
  },
}
