# OpenAI Chat Completions API Schema

Extracted from codebase analysis of `/litellm` and `/opencode` directories.

## 1. Request Schema

### Complete Request Structure

```typescript
interface ChatCompletionRequest {
  // Required
  model: string
  messages: Message[]
  
  // Optional parameters
  max_tokens?: number
  temperature?: number           // 0-2, default 1
  top_p?: number                 // 0-1, default 1
  stream?: boolean
  stop?: string | string[]
  
  // Tool calling
  tools?: Tool[]
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } }
  parallel_tool_calls?: boolean
  
  // Advanced
  frequency_penalty?: number     // -2 to 2
  presence_penalty?: number      // -2 to 2
  logit_bias?: Record<string, number>
  logprobs?: boolean
  top_logprobs?: number          // 0-20
  n?: number                     // number of completions
  seed?: number
  response_format?: { type: "text" | "json_object" }
  service_tier?: string
  user?: string
  
  // Streaming
  stream_options?: { include_usage: boolean }
  
  // Reasoning (o1/o3 models)
  reasoning_effort?: string
  
  // Deprecated
  functions?: Function[]
  function_call?: string | { name: string }
}
```

### Message Types

```typescript
// Union of all message types
type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage

// System message
interface SystemMessage {
  role: "system"
  content: string | ContentPart[]
  name?: string
}

// Developer message (newer alternative to system)
interface DeveloperMessage {
  role: "developer"
  content: string | ContentPart[]
  name?: string
}

// User message
interface UserMessage {
  role: "user"
  content: string | ContentPart[]
}

// Assistant message
interface AssistantMessage {
  role: "assistant"
  content?: string | ContentPart[]
  name?: string
  tool_calls?: ToolCall[]
  function_call?: { name: string; arguments: string }  // deprecated
  reasoning_content?: string  // for reasoning models
}

// Tool result message
interface ToolMessage {
  role: "tool"
  content: string | ContentPart[]
  tool_call_id: string
}

// Function result message (deprecated)
interface FunctionMessage {
  role: "function"
  content: string | null
  name: string
  tool_call_id?: string
}
```

### Content Part Types

```typescript
type ContentPart = TextContent | ImageContent | AudioContent | VideoContent | FileContent

interface TextContent {
  type: "text"
  text: string
}

interface ImageContent {
  type: "image_url"
  image_url: string | {
    url: string           // URL or base64 data URI
    detail?: "auto" | "low" | "high"
  }
}

interface AudioContent {
  type: "input_audio"
  input_audio: {
    data: string          // base64 encoded audio
    format: "wav" | "mp3"
  }
}

interface VideoContent {
  type: "video_url"
  video_url: string | {
    url: string
    detail?: string
  }
}

interface FileContent {
  type: "file"
  file: {
    file_data?: string
    file_id?: string
    filename?: string
    format?: string
  }
}
```

### Tool Definition

```typescript
interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: JSONSchema     // JSON Schema object
    strict?: boolean            // Enable strict mode
  }
}

// JSON Schema for parameters
interface JSONSchema {
  type: "object"
  properties: Record<string, {
    type: string
    description?: string
    enum?: string[]
    items?: JSONSchema
    // ... other JSON Schema properties
  }>
  required?: string[]
  additionalProperties?: boolean
}
```

### Tool Call (in assistant message)

```typescript
interface ToolCall {
  id: string                    // e.g., "call_abc123"
  type: "function"
  function: {
    name: string
    arguments: string           // JSON string
  }
}
```

## 2. Response Schema

### Complete Response Structure

```typescript
interface ChatCompletionResponse {
  id: string                    // e.g., "chatcmpl-abc123"
  object: "chat.completion"
  created: number               // Unix timestamp
  model: string
  choices: Choice[]
  usage?: Usage
  system_fingerprint?: string
}

interface Choice {
  index: number
  message: ResponseMessage
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs?: LogProbs | null
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: ToolCall[]
  function_call?: { name: string; arguments: string }  // deprecated
  refusal?: string | null
  reasoning_content?: string    // for reasoning models
}

interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: {
    cached_tokens?: number
    audio_tokens?: number
    text_tokens?: number
    image_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
    accepted_prediction_tokens?: number
    rejected_prediction_tokens?: number
  }
}
```

## 3. Streaming Format

### SSE Format

Streaming uses Server-Sent Events (SSE):

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk",...}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk",...}

data: [DONE]
```

### Chunk Structure

```typescript
interface ChatCompletionChunk {
  id: string                      // e.g., "chatcmpl-abc123"
  object: "chat.completion.chunk"
  created: number                 // Unix timestamp
  model: string
  choices: ChunkChoice[]
  usage?: Usage                   // Only with stream_options.include_usage
}

interface ChunkChoice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs?: LogProbs | null
}

interface Delta {
  role?: "assistant"              // Only in first chunk
  content?: string                // Incremental text
  tool_calls?: DeltaToolCall[]
}

interface DeltaToolCall {
  index: number
  id?: string                     // Only in first chunk for this tool call
  type?: "function"               // Only in first chunk for this tool call
  function?: {
    name?: string                 // Only in first chunk for this tool call
    arguments?: string            // Incremental JSON string
  }
}
```

### Streaming Examples

**Text Content Stream:**
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Tool Call Stream:**
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"lo"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"cation\":"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"NYC\"}"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

## 4. Request/Response Examples

### Basic Chat Request

```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### Basic Chat Response

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1694268190,
  "model": "gpt-4-0613",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

### Tool Calling Request

```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "What's the weather in NYC?"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather in a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"]
            }
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

### Tool Calling Response

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1694268190,
  "model": "gpt-4-0613",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\":\"NYC\",\"unit\":\"fahrenheit\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 82,
    "completion_tokens": 17,
    "total_tokens": 99
  }
}
```

### Tool Result Message

```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "What's the weather in NYC?"},
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"location\":\"NYC\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"temperature\": 72, \"unit\": \"fahrenheit\", \"condition\": \"sunny\"}"
    }
  ]
}
```

### Multimodal (Image) Request

```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What's in this image?"},
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/image.jpg",
            "detail": "high"
          }
        }
      ]
    }
  ]
}
```

## 5. Source References

- **LiteLLM Types**: `litellm/litellm/types/llms/openai.py`
  - `ChatCompletionRequest` (line 881)
  - `ChatCompletionAssistantToolCall` (line 492)
  - `ChatCompletionDeltaToolCallChunk` (line 505)
  - `ChatCompletionResponseMessage` (line 920)
  - `ChatCompletionUsageBlock` (line 932)

- **OpenCode Common Types**: `opencode/packages/console/app/src/routes/zen/util/provider/provider.ts`
  - `CommonRequest` (line 99)
  - `CommonResponse` (line 111)
  - `CommonChunk` (line 133)
  - `CommonToolCall` (line 62)
  - `CommonTool` (line 71)

- **OpenAI-Compatible Provider**: `opencode/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts`
  - `fromOaCompatibleRequest` (line 73)
  - `toOaCompatibleRequest` (line 130)
  - `fromOaCompatibleChunk` (line 393)
  - `toOaCompatibleChunk` (line 470)
