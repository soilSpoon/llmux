# Anthropic/Claude API Schema Analysis

Based on analysis of codebase: `litellm/`, `opencode/`, `opencode-antigravity-auth/`

## 1. Request Schema

### Headers

```http
x-api-key: <API_KEY>
anthropic-version: 2023-06-01
anthropic-beta: <comma-separated beta features>
```

**anthropic-beta values** (from `litellm/litellm/types/llms/anthropic.py:626-638`):
- `prompt-caching-2024-07-31` - Prompt caching
- `web-fetch-2025-09-10` - Web fetch tool
- `web-search-2025-03-05` - Web search tool
- `context-management-2025-06-27` - Context management
- `structured-outputs-2025-11-13` - Structured outputs
- `advanced-tool-use-2025-11-20` - Tool search, deferred tools
- `skills-2025-10-02` - Skills API
- `message-batches-2024-09-24` - Batch processing
- `context-1m-2025-08-07` - Extended context (1M)
- `interleaved-thinking-2025-05-14` - Interleaved thinking

### Request Body (AnthropicMessagesRequest)

```typescript
interface AnthropicMessagesRequest {
  // Required
  model: string;                    // e.g., "claude-sonnet-4-20250514"
  messages: Message[];              // User/Assistant message array
  
  // Optional
  max_tokens?: number;              // Default: 4096
  system?: string | SystemBlock[];  // Top-level system prompt
  stream?: boolean;                 // Enable streaming
  temperature?: number;             // 0.0 - 1.0
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: { user_id?: string };
  
  // Tools
  tools?: Tool[];
  tool_choice?: ToolChoice;
  
  // Extended Thinking
  thinking?: {
    type: "enabled";
    budget_tokens: number;          // e.g., 16000
  };
  
  // Advanced features
  mcp_servers?: McpServerTool[];
  context_management?: object;
  container?: object;               // Code execution container
}
```

### Message Structure

```typescript
// User Message
interface UserMessage {
  role: "user";
  content: string | UserContentBlock[];
}

type UserContentBlock = 
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolResultBlock
  | ContainerUploadBlock;

// Assistant Message  
interface AssistantMessage {
  role: "assistant";
  content: string | AssistantContentBlock[];
}

type AssistantContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock;
```

### Content Block Types

```typescript
// Text Block
interface TextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

// Image Block
interface ImageBlock {
  type: "image";
  source: 
    | { type: "base64"; media_type: string; data: string }
    | { type: "url"; url: string }
    | { type: "file"; file_id: string };
  cache_control?: { type: "ephemeral" };
}

// Document Block (PDFs)
interface DocumentBlock {
  type: "document";
  source: ImageBlock["source"];
  title?: string;
  context?: string;
  citations?: { enabled: boolean };
  cache_control?: { type: "ephemeral" };
}

// Tool Use Block (in assistant messages)
interface ToolUseBlock {
  type: "tool_use";
  id: string;                       // e.g., "toolu_01T1x1fJ34qAmk2tNTrN7Up6"
  name: string;
  input: object;
  cache_control?: { type: "ephemeral" };
  caller?: ToolCaller;              // For programmatic tool calling
}

// Tool Result Block (in user messages)
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;              // References tool_use.id
  content: string | ToolResultContent[];
  is_error?: boolean;
  cache_control?: { type: "ephemeral" };
}

// Thinking Block (extended thinking)
interface ThinkingBlock {
  type: "thinking";
  thinking: string;                 // The reasoning text
  signature: string;                // Cryptographic signature
  cache_control?: { type: "ephemeral" };
}

// Redacted Thinking Block
interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
  cache_control?: { type: "ephemeral" };
}
```

### System Message Structure

```typescript
// Can be string or array
type System = string | SystemBlock[];

interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}
```

### Tools Structure

```typescript
// Custom Tool
interface CustomTool {
  type?: "custom";
  name: string;
  description?: string;
  input_schema: {
    type?: string;
    properties?: object;
    required?: string[];
    additionalProperties?: boolean;
    $defs?: object;
    strict?: boolean;
  };
  cache_control?: { type: "ephemeral" };
  defer_loading?: boolean;
  allowed_callers?: string[];       // e.g., ["code_execution_20250825"]
  input_examples?: object[];
}

// Built-in Tools
interface WebSearchTool {
  type: "web_search";
  name: "web_search";
  max_uses?: number;                // Default: { low: 1, medium: 3, high: 5 }
  user_location?: {
    type: "approximate";
    city?: string;
    country?: string;
    region?: string;
    timezone?: string;
  };
  cache_control?: { type: "ephemeral" };
}

interface ComputerTool {
  type: "computer_20250124";        // Versioned type
  name: string;
  display_width_px: number;
  display_height_px: number;
  display_number?: number;
  cache_control?: { type: "ephemeral" };
}

interface CodeExecutionTool {
  type: "code_execution_20250825";
  name: "code_execution";
  cache_control?: { type: "ephemeral" };
}

interface BashTool {
  type: "bash_20250124";
  name: "bash";
  cache_control?: { type: "ephemeral" };
}

interface TextEditorTool {
  type: "text_editor_20250124";
  name: "text_editor";
  cache_control?: { type: "ephemeral" };
}

// Tool Choice
interface ToolChoice {
  type: "auto" | "any" | "tool" | "none";
  name?: string;                    // Required if type === "tool"
  disable_parallel_tool_use?: boolean;
}
```

---

## 2. Response Schema

### Non-Streaming Response

```typescript
interface AnthropicResponse {
  id: string;                       // e.g., "msg_01XFDUDYJgAACzvnptvVoYEL"
  type: "message";
  role: "assistant";
  model: string;
  content: ResponseContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

type ResponseContentBlock =
  | ResponseTextBlock
  | ResponseToolUseBlock
  | ResponseThinkingBlock
  | ResponseRedactedThinkingBlock;

interface ResponseTextBlock {
  type: "text";
  text: string;
}

interface ResponseToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: object;
  caller?: ToolCaller;              // For programmatic calls
}

interface ResponseThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;                // Must be preserved for multi-turn
}

interface ResponseRedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}
```

### Example Response

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-20250514",
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me analyze this step by step...",
      "signature": "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk..."
    },
    {
      "type": "text",
      "text": "Based on my analysis, here's the solution..."
    },
    {
      "type": "tool_use",
      "id": "toolu_01T1x1fJ34qAmk2tNTrN7Up6",
      "name": "get_weather",
      "input": { "location": "San Francisco" }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 270,
    "output_tokens": 156,
    "cache_read_input_tokens": 100
  }
}
```

---

## 3. Streaming Format

### Event Types

```
event: message_start
event: content_block_start
event: content_block_delta
event: content_block_stop
event: message_delta
event: message_stop
event: ping
event: error
```

### SSE Format

Each event follows the pattern:
```
event: <event_type>
data: <json_payload>

```

### Streaming Event Schemas

```typescript
// message_start - First event with message metadata
interface MessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: [];
    stop_reason: null;
    stop_sequence: null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

// content_block_start - New content block begins
interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: 
    | { type: "text"; text: "" }
    | { type: "tool_use"; id: string; name: string; input: {} }
    | { type: "thinking"; thinking: "" };
}

// content_block_delta - Incremental content updates
interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string }
    | { type: "thinking_delta"; thinking: string }
    | { type: "signature_delta"; signature: string }
    | { type: "citations"; citation: object };
}

// content_block_stop - Block completed
interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

// message_delta - Message-level updates (stop_reason, usage)
interface MessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
    stop_sequence?: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

// message_stop - Stream complete
interface MessageStopEvent {
  type: "message_stop";
}
```

### Streaming Example

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_01XFDUDYJgAACzvnptvVoYEL","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":270,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me solve"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" this step by step..."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":", how can I help?"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_01T1x1fJ34qAmk2tNTrN7Up6","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"location\": \"San Fra"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"ncisco\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":156}}

event: message_stop
data: {"type":"message_stop"}
```

---

## 4. Key Implementation Notes

### Thinking Block Signatures

From `opencode-antigravity-auth/src/plugin/request-helpers.ts`:

1. **Signature Validation**: Thinking blocks require a valid signature (≥50 chars)
2. **Signature Caching**: Signatures must be cached per-session for multi-turn conversations
3. **Trailing Block Removal**: Assistant messages cannot end with unsigned thinking blocks
4. **Signature Restoration**: When sending back thinking blocks, restore cached signatures

```typescript
// Anthropic-style thinking block
{ type: "thinking", thinking: "...", signature: "EqQB..." }

// Gemini-style thinking block (Antigravity)
{ thought: true, text: "...", thoughtSignature: "EqQB..." }
```

### Tool Use ID Format

Tool use IDs follow pattern: `toolu_<random_string>`

Example: `toolu_01T1x1fJ34qAmk2tNTrN7Up6`

### Stop Reason Mapping

| Anthropic | OpenAI |
|-----------|--------|
| `end_turn` | `stop` |
| `tool_use` | `tool_calls` |
| `max_tokens` | `length` |
| `content_filter` | `content_filter` |
| `stop_sequence` | `stop` |

### Usage Tracking (Streaming)

From `opencode/packages/console/app/src/routes/zen/util/provider/anthropic.ts`:

```typescript
interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  server_tool_use?: {
    web_search_requests?: number;
  };
}
```

---

## 5. File References

| Component | Source Files |
|-----------|-------------|
| Type Definitions | [`litellm/litellm/types/llms/anthropic.py`](file:///home/dh/dev/CLIProxyAPI/litellm/litellm/types/llms/anthropic.py) |
| Thinking Blocks | [`litellm/litellm/types/llms/openai.py#L516-L527`](file:///home/dh/dev/CLIProxyAPI/litellm/litellm/types/llms/openai.py#L516-L527) |
| Request Transformation | [`litellm/litellm/llms/anthropic/chat/transformation.py`](file:///home/dh/dev/CLIProxyAPI/litellm/litellm/llms/anthropic/chat/transformation.py) |
| Headers/Utils | [`litellm/litellm/llms/anthropic/common_utils.py`](file:///home/dh/dev/CLIProxyAPI/litellm/litellm/llms/anthropic/common_utils.py) |
| OpenCode Anthropic Helper | [`opencode/packages/console/app/src/routes/zen/util/provider/anthropic.ts`](file:///home/dh/dev/CLIProxyAPI/opencode/packages/console/app/src/routes/zen/util/provider/anthropic.ts) |
| Thinking Block Filtering | [`opencode-antigravity-auth/src/plugin/request-helpers.ts`](file:///home/dh/dev/CLIProxyAPI/opencode-antigravity-auth/src/plugin/request-helpers.ts) |
| Claude Model Flow | [`opencode-antigravity-auth/docs/CLAUDE_MODEL_FLOW.md`](file:///home/dh/dev/CLIProxyAPI/opencode-antigravity-auth/docs/CLAUDE_MODEL_FLOW.md) |
