/**
 * OpenAI Responses API wire format fixtures
 * Note: Responses API uses 'input' instead of 'messages' and 'input_text' content type
 */

export const OpenAIResponsesFixtures = {
  requests: {
    simple: {
      model: 'gpt-4o',
      input: [{ role: 'user', content: 'Hello, world!' }],
    },
    withInputText: {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello with input_text' }],
        },
      ],
    },
    withInstructions: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      instructions: 'You are a helpful assistant.',
    },
    withMaxOutputTokens: {
      model: 'gpt-4o',
      input: [{ role: 'user', content: 'Hello' }],
      max_output_tokens: 2000,
      temperature: 0.8,
    },
    withTools: {
      model: 'gpt-4o',
      input: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        },
      ],
    },
    withMultipartContent: {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          ],
        },
      ],
    },
    withToolCall: {
      model: 'gpt-4o',
      input: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"NYC"}',
              },
            },
          ],
        },
      ],
    },
    withToolResult: {
      model: 'gpt-4o',
      input: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"NYC"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_abc123',
          content: '{"temperature": 72}',
        },
      ],
    },
  },

  responses: {
    simple: {
      id: 'chatcmpl-resp123',
      object: 'chat.completion',
      created: 1704067200,
      model: 'gpt-4o-2024-08-06',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help you today?' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      },
    },
    withToolCall: {
      id: 'chatcmpl-resp456',
      object: 'chat.completion',
      created: 1704067200,
      model: 'gpt-4o-2024-08-06',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"NYC"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 30,
        total_tokens: 50,
      },
    },
  },

  streaming: {
    chunks: [
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ],
  },
}
