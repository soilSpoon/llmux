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
  },
}
