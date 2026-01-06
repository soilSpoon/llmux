/**
 * OpenAI Chat Completions API wire format fixtures
 */

export const OpenAIChatFixtures = {
  requests: {
    simple: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello, world!' }],
    },
    withSystem: {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
    },
    withToolCall: {
      model: 'gpt-4',
      messages: [
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
                arguments: '{"location":"NYC","unit":"celsius"}',
              },
            },
          ],
        },
      ],
    },
    withToolResult: {
      model: 'gpt-4',
      messages: [
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
          content: '{"temperature": 72, "condition": "sunny"}',
        },
      ],
    },
    withConfig: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1000,
      temperature: 0.7,
      top_p: 0.9,
      stop: ['STOP', 'END'],
    },
    withTools: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
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
                unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
              },
              required: ['location'],
            },
          },
        },
      ],
    },
    multipartContent: {
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          ],
        },
      ],
    },
  },

  responses: {
    simple: {
      id: 'chatcmpl-abc123',
      object: 'chat.completion',
      created: 1704067200,
      model: 'gpt-4-0613',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help you today?' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    },
    withToolCall: {
      id: 'chatcmpl-abc456',
      object: 'chat.completion',
      created: 1704067200,
      model: 'gpt-4-0613',
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
                  arguments: '{"location":"NYC","unit":"celsius"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      },
    },
    multipleToolCalls: {
      id: 'chatcmpl-abc789',
      object: 'chat.completion',
      created: 1704067200,
      model: 'gpt-4-0613',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Let me check both locations.',
            tool_calls: [
              {
                id: 'call_weather1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"NYC"}',
                },
              },
              {
                id: 'call_weather2',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"LA"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    maxTokens: {
      id: 'chatcmpl-max123',
      object: 'chat.completion',
      created: 1704067200,
      model: 'gpt-4-0613',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'This response was truncated because...' },
          finish_reason: 'length',
        },
      ],
    },
  },

  streaming: {
    chunks: [
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream1","object":"chat.completion.chunk","created":1704067200,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ],
    toolCallChunks: [
      'data: {"id":"chatcmpl-stream2","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"loc"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\\":"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream2","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"NYC\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-stream2","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ],
  },
}
