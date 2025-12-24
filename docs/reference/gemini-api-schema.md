# Gemini API Schema Documentation

This document describes the Gemini API request/response schema as used in this codebase.

## Request Schema

### Top-Level Request Body

```typescript
interface RequestBody {
  contents: ContentType[];          // Required: conversation history
  systemInstruction?: SystemInstruction;  // NOT a string - must be { parts: [] }
  tools?: Tool[];
  toolConfig?: ToolConfig;
  generationConfig?: GenerationConfig;
  safetySettings?: SafetySettings[];
  cachedContent?: string;           // Cache name reference
}
```

### Contents Structure

```typescript
interface ContentType {
  role: "user" | "model";
  parts: PartType[];
}
```

### Part Types

```typescript
interface PartType {
  // Text content
  text?: string;
  
  // Inline binary data (images, etc.)
  inlineData?: {
    mimeType: string;
    data: string;  // base64 encoded
  };
  
  // Cloud storage file reference
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  
  // Function/tool call (model output)
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  
  // Function/tool response (user input)
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
  
  // Thinking blocks (Gemini 2.5/3)
  thought?: boolean;
  thoughtSignature?: string;
  
  // Media resolution hint
  mediaResolution?: "low" | "medium" | "high";
}
```

### System Instruction Format

**Important**: `systemInstruction` must be an object with `parts[]`, NOT a plain string.

```typescript
interface SystemInstruction {
  parts: Array<{ text: string }>;
}

// Correct usage:
{
  systemInstruction: {
    parts: [{ text: "You are a helpful assistant." }]
  }
}

// WRONG (will not work):
{
  systemInstruction: "You are a helpful assistant."  // ❌
}
```

### Tools Structure

```typescript
interface Tool {
  // Function declarations for custom tools
  functionDeclarations?: FunctionDeclaration[];
  
  // Built-in tools
  googleSearch?: {};
  googleSearchRetrieval?: {};
  enterpriseWebSearch?: {};
  urlContext?: {};
  codeExecution?: {};
  googleMaps?: {};
  computerUse?: {};
}

interface FunctionDeclaration {
  name: string;                    // Required: ^[a-zA-Z_][a-zA-Z0-9_-]*$
  description?: string;
  parameters?: Schema;             // JSON Schema for parameters
  parametersJsonSchema?: Schema;   // Alternative key name
}

interface Schema {
  type: "STRING" | "INTEGER" | "BOOLEAN" | "NUMBER" | "ARRAY" | "OBJECT";
  format?: "enum" | "date-time";
  description?: string;
  nullable?: boolean;
  items?: Schema;              // For arrays
  properties?: Record<string, Schema>;
  required?: string[];
  enum?: string[];
  anyOf?: Schema[];
}
```

### Tool Config

```typescript
interface ToolConfig {
  functionCallingConfig?: {
    mode: "AUTO" | "ANY" | "NONE" | "VALIDATED";
    allowedFunctionNames?: string[];
  };
}
```

### Generation Config

```typescript
interface GenerationConfig {
  temperature?: number;           // 0.0 - 2.0
  topP?: number;                  // 0.0 - 1.0
  topK?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  stopSequences?: string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseMimeType?: "text/plain" | "application/json";
  responseSchema?: Schema;
  seed?: number;
  responseLogprobs?: boolean;
  logprobs?: number;
  
  // Modality controls (Gemini 2.5+)
  responseModalities?: ("TEXT" | "IMAGE" | "AUDIO" | "VIDEO")[];
  imageConfig?: {
    aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
    imageSize?: "1K" | "2K" | "4K";
  };
  
  // Thinking configuration
  thinkingConfig?: ThinkingConfig;
  
  // Speech output
  speechConfig?: {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: string };
    };
  };
}
```

### Thinking Config

```typescript
interface ThinkingConfig {
  includeThoughts?: boolean;
  
  // For Gemini 2.5 models - use token budget
  thinkingBudget?: number;
  
  // For Gemini 3 models - use level
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}
```

## Response Schema

### GenerateContent Response

```typescript
interface GenerateContentResponse {
  candidates: Candidate[];
  usageMetadata: UsageMetadata;
  promptFeedback?: PromptFeedback;
  responseId?: string;
}
```

### Candidate Structure

```typescript
interface Candidate {
  index?: number;
  content: {
    role: "model";
    parts: ResponsePart[];
  };
  finishReason: FinishReason;
  safetyRatings?: SafetyRating[];
  citationMetadata?: CitationMetadata;
  groundingMetadata?: GroundingMetadata;
  urlContextMetadata?: UrlContextMetadata;
  logprobsResult?: LogprobsResult;
}

type FinishReason = 
  | "FINISH_REASON_UNSPECIFIED"
  | "STOP"
  | "MAX_TOKENS"
  | "SAFETY"
  | "RECITATION"
  | "OTHER"
  | "BLOCKLIST"
  | "PROHIBITED_CONTENT"
  | "SPII";
```

### Response Part Types

```typescript
interface ResponsePart {
  // Text response
  text?: string;
  
  // Function call request
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  
  // Thinking content (Gemini 2.5/3)
  thought?: boolean;           // true for thinking blocks
  thoughtSignature?: string;   // Signature for verification
  
  // Code execution results
  executableCode?: {
    code: string;
    language: string;
  };
  codeExecutionResult?: {
    outcome: string;
    output: string;
  };
  
  // Inline data (for image generation)
  inlineData?: {
    mimeType: string;
    data: string;
  };
}
```

### Usage Metadata

```typescript
interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;       // Output tokens
  totalTokenCount: number;
  cachedContentTokenCount?: number;   // Tokens from cache
  thoughtsTokenCount?: number;        // Thinking tokens (Gemini 2.5/3)
  
  // Detailed breakdown
  promptTokensDetails?: TokenDetail[];
  responseTokensDetails?: TokenDetail[];
  candidatesTokensDetails?: TokenDetail[];  // Alternative key
}

interface TokenDetail {
  modality: "TEXT" | "AUDIO" | "IMAGE" | "VIDEO";
  tokenCount: number;
}
```

### Grounding Metadata (for Google Search)

```typescript
interface GroundingMetadata {
  webSearchQueries?: string[];
  searchEntryPoint?: {
    renderedContent?: string;
    sdkBlob?: string;
  };
  groundingChunks?: Array<{
    web?: {
      uri: string;
      title: string;
    };
  }>;
  groundingAttributions?: any[];
}
```

## Streaming Format

### SSE Data Format

Streaming responses use Server-Sent Events (SSE) with `data:` prefix:

```
data: {"candidates":[...],"usageMetadata":{...}}

data: {"candidates":[...],"usageMetadata":{...}}

data: {"candidates":[{"finishReason":"STOP",...}],"usageMetadata":{...}}
```

### Streaming Chunk Example

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{ "text": "Hello" }]
    },
    "finishReason": null
  }],
  "usageMetadata": {
    "promptTokenCount": 10,
    "candidatesTokenCount": 1,
    "totalTokenCount": 11
  }
}
```

### Final Chunk with Finish Reason

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{ "text": " world!" }]
    },
    "finishReason": "STOP"
  }],
  "usageMetadata": {
    "promptTokenCount": 10,
    "candidatesTokenCount": 5,
    "totalTokenCount": 15
  }
}
```

## Complete Request Examples

### Basic Chat Request

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Hello, how are you?" }]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 1024,
    "temperature": 0.7
  }
}
```

### Request with System Instruction

```json
{
  "systemInstruction": {
    "parts": [{ "text": "You are a helpful coding assistant." }]
  },
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Write a hello world in Python" }]
    }
  ]
}
```

### Request with Tools

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "What's the weather in Tokyo?" }]
    }
  ],
  "tools": [{
    "functionDeclarations": [{
      "name": "get_weather",
      "description": "Get current weather for a location",
      "parameters": {
        "type": "OBJECT",
        "properties": {
          "location": {
            "type": "STRING",
            "description": "City name"
          }
        },
        "required": ["location"]
      }
    }]
  }],
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "AUTO"
    }
  }
}
```

### Request with Google Search

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "What are the latest news about AI?" }]
    }
  ],
  "tools": [{
    "googleSearch": {}
  }]
}
```

### Request with Thinking (Gemini 3)

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Solve this complex math problem..." }]
    }
  ],
  "generationConfig": {
    "thinkingConfig": {
      "thinkingLevel": "high",
      "includeThoughts": true
    }
  }
}
```

### Request with Thinking (Gemini 2.5)

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Analyze this code for bugs..." }]
    }
  ],
  "generationConfig": {
    "thinkingConfig": {
      "thinkingBudget": 8192,
      "includeThoughts": true
    }
  }
}
```

### Multi-turn with Function Call/Response

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "What's the weather?" }]
    },
    {
      "role": "model",
      "parts": [{
        "functionCall": {
          "name": "get_weather",
          "args": { "location": "Tokyo" }
        }
      }]
    },
    {
      "role": "user",
      "parts": [{
        "functionResponse": {
          "name": "get_weather",
          "response": { "temperature": 22, "condition": "sunny" }
        }
      }]
    }
  ]
}
```

## Response Examples

### Text Response

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{ "text": "Hello! I'm doing well, thank you for asking." }]
    },
    "finishReason": "STOP"
  }],
  "usageMetadata": {
    "promptTokenCount": 6,
    "candidatesTokenCount": 12,
    "totalTokenCount": 18
  }
}
```

### Function Call Response

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{
        "functionCall": {
          "name": "get_weather",
          "args": {
            "location": "Tokyo"
          }
        }
      }]
    },
    "finishReason": "STOP"
  }],
  "usageMetadata": {
    "promptTokenCount": 50,
    "candidatesTokenCount": 15,
    "totalTokenCount": 65
  }
}
```

### Response with Thinking Blocks

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [
        {
          "thought": true,
          "text": "Let me analyze this step by step...",
          "thoughtSignature": "abc123..."
        },
        {
          "text": "The answer is 42."
        }
      ]
    },
    "finishReason": "STOP"
  }],
  "usageMetadata": {
    "promptTokenCount": 100,
    "candidatesTokenCount": 50,
    "thoughtsTokenCount": 200,
    "totalTokenCount": 350
  }
}
```

### Response with Grounding (Google Search)

```json
{
  "candidates": [{
    "content": {
      "role": "model",
      "parts": [{ "text": "According to recent reports..." }]
    },
    "finishReason": "STOP",
    "groundingMetadata": {
      "webSearchQueries": ["latest AI news 2024"],
      "groundingChunks": [{
        "web": {
          "uri": "https://example.com/ai-news",
          "title": "AI News Today"
        }
      }]
    }
  }],
  "usageMetadata": {
    "promptTokenCount": 10,
    "candidatesTokenCount": 100,
    "totalTokenCount": 110
  }
}
```

## Key Differences from OpenAI

| Feature | Gemini | OpenAI |
|---------|--------|--------|
| Message role | `contents[].role` | `messages[].role` |
| System prompt | `systemInstruction.parts[]` | `messages[{role:"system"}]` |
| Tool calls | `functionCall` in parts | `tool_calls[]` in message |
| Tool results | `functionResponse` in parts | `tool` role message |
| Max tokens | `generationConfig.maxOutputTokens` | `max_tokens` |
| Thinking | `thinkingConfig` | `reasoning_effort` |
| Streaming | SSE with `data: {...}` | SSE with `data: {...}` |
