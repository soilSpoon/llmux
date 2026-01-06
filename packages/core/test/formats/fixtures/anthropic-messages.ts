/**
 * Anthropic Messages API wire format fixtures
 */

export const AnthropicMessagesFixtures = {
  requests: {
    simple: {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    },
    withSystem: {
      model: 'claude-3-opus-20240229',
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    },
    withSystemArray: {
      model: 'claude-3-opus-20240229',
      system: [
        { type: 'text', text: 'You are a helpful assistant.' },
        { type: 'text', text: 'Be concise.', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    },
    withToolUse: {
      model: 'claude-3-opus-20240229',
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_abc123',
              name: 'get_weather',
              input: { location: 'NYC' },
            },
          ],
        },
      ],
      max_tokens: 1024,
    },
    withToolResult: {
      model: 'claude-3-opus-20240229',
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_abc123',
              name: 'get_weather',
              input: { location: 'NYC' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_abc123',
              content: '{"temperature": 72, "condition": "sunny"}',
            },
          ],
        },
      ],
      max_tokens: 1024,
    },
    withConfig: {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 2048,
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ['STOP', 'END'],
    },
    withTools: {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      ],
    },
    multipartContent: {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
      ],
      max_tokens: 1024,
    },
  },

  responses: {
    simple: {
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
      model: 'claude-3-opus-20240229',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    },
    withToolUse: {
      id: 'msg_abc456',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check the weather for you.' },
        {
          type: 'tool_use',
          id: 'call_abc123',
          name: 'get_weather',
          input: { location: 'NYC' },
        },
      ],
      model: 'claude-3-opus-20240229',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 15,
        output_tokens: 30,
      },
    },
    multipleToolUse: {
      id: 'msg_abc789',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking both locations.' },
        {
          type: 'tool_use',
          id: 'call_weather1',
          name: 'get_weather',
          input: { location: 'NYC' },
        },
        {
          type: 'tool_use',
          id: 'call_weather2',
          name: 'get_weather',
          input: { location: 'LA' },
        },
      ],
      model: 'claude-3-opus-20240229',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 20,
        output_tokens: 40,
      },
    },
    maxTokens: {
      id: 'msg_max123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'This response was truncated...' }],
      model: 'claude-3-opus-20240229',
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 1024,
      },
    },
  },

  streaming: {
    messageStart: 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream1","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
    contentBlockStart: 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    contentBlockDelta: 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
    contentBlockStop: 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
    messageDelta: 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}',
    messageStop: 'event: message_stop\ndata: {"type":"message_stop"}',
    toolUseStart: 'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_123","name":"get_weather","input":{}}}',
    toolUseDelta: 'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":\\"NYC\\"}"}}',
    chunks: [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream1","type":"message","role":"assistant","content":[],"model":"claude-3-opus-20240229","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ],
  },
}
