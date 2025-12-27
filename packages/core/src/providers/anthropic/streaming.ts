/**
 * Anthropic Streaming Transformations
 *
 * Handles parsing and transforming Anthropic SSE stream events
 */

import type { StopReason, StreamChunk } from "../../types/unified";
import type {
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStartEvent,
  AnthropicErrorEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStartEvent,
  AnthropicStreamEvent,
} from "./types";
import { isAnthropicStreamEvent } from "./types";

/**
 * Parse an Anthropic SSE chunk into a unified StreamChunk
 */
export function parseStreamChunk(chunk: string): StreamChunk | null {
  const event = parseSSE(chunk);
  if (!event) return null;

  return convertEventToChunk(event);
}

/**
 * Transform a unified StreamChunk into an Anthropic SSE string
 */
export function transformStreamChunk(chunk: StreamChunk): string | string[] {
  return convertChunkToSSE(chunk);
}

// =============================================================================
// SSE Parsing
// =============================================================================

function parseSSE(sseData: string): AnthropicStreamEvent | null {
  if (!sseData || sseData.trim() === "") return null;

  // Parse SSE format: "event: <type>\ndata: <json>"
  const lines = sseData.split("\n");
  let dataLine: string | null = null;

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      dataLine = line.slice(6);
    }
  }

  if (!dataLine) return null;

  try {
    const data = JSON.parse(dataLine);
    if (isAnthropicStreamEvent(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function convertEventToChunk(event: AnthropicStreamEvent): StreamChunk | null {
  switch (event.type) {
    case "message_start":
      return handleMessageStart(event as AnthropicMessageStartEvent);

    case "content_block_start":
      return handleContentBlockStart(event as AnthropicContentBlockStartEvent);

    case "content_block_delta":
      return handleContentBlockDelta(event as AnthropicContentBlockDeltaEvent);

    case "content_block_stop":
      // No action needed for content_block_stop
      return null;

    case "message_delta":
      return handleMessageDelta(event as AnthropicMessageDeltaEvent);

    case "message_stop":
      return handleMessageStop();

    case "ping":
      // Ignore ping events
      return null;

    case "error":
      return handleError(event as AnthropicErrorEvent);

    default:
      return null;
  }
}

function handleMessageStart(event: AnthropicMessageStartEvent): StreamChunk {
  return {
    type: "usage",
    usage: {
      inputTokens: event.message.usage.input_tokens,
      outputTokens: event.message.usage.output_tokens,
    },
  };
}

function handleContentBlockStart(
  event: AnthropicContentBlockStartEvent
): StreamChunk | null {
  const block = event.content_block;

  switch (block.type) {
    case "tool_use":
      return {
        type: "tool_call",
        delta: {
          toolCall: {
            id: block.id,
            name: block.name,
            arguments: block.input,
          },
        },
      };

    case "text":
    case "thinking":
      // Text and thinking block starts don't produce chunks
      return null;

    default:
      return null;
  }
}

function handleContentBlockDelta(
  event: AnthropicContentBlockDeltaEvent
): StreamChunk | null {
  const delta = event.delta;

  switch (delta.type) {
    case "text_delta":
      return {
        type: "content",
        delta: {
          text: delta.text,
        },
      };

    case "thinking_delta":
      return {
        type: "thinking",
        delta: {
          thinking: {
            text: delta.thinking,
          },
        },
      };

    case "signature_delta":
      return {
        type: "thinking",
        delta: {
          thinking: {
            text: "",
            signature: delta.signature,
          },
        },
      };

    case "input_json_delta":
      // Tool input is being streamed
      return {
        type: "tool_call",
        delta: {
          text: delta.partial_json,
        },
      };

    default:
      return null;
  }
}

function handleMessageDelta(event: AnthropicMessageDeltaEvent): StreamChunk {
  return {
    type: "usage",
    usage: {
      inputTokens: 0,
      outputTokens: event.usage.output_tokens,
    },
    stopReason: parseStopReason(event.delta.stop_reason),
  };
}

function handleMessageStop(): StreamChunk {
  return {
    type: "done",
  };
}

function handleError(event: AnthropicErrorEvent): StreamChunk {
  return {
    type: "error",
    error: event.error.message,
  };
}

function parseStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return null;
  }
}

// =============================================================================
// SSE Transformation
// =============================================================================

function convertChunkToSSE(chunk: StreamChunk): string | string[] {
  switch (chunk.type) {
    case "content":
      return formatSSE("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: chunk.delta?.text || "",
        },
      });

    case "thinking": {
      // Thinking chunks contain reasoning text
      // Convert to thinking_delta for clients that support extended thinking
      const thinkingText = chunk.delta?.thinking?.text || "";
      const thinkingSignature = chunk.delta?.thinking?.signature;

      // If we have a signature, output signature_delta
      if (thinkingSignature) {
        return formatSSE("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "signature_delta",
            signature: thinkingSignature,
          },
        });
      }

      // Skip empty thinking chunks
      if (!thinkingText) {
        return "";
      }

      return formatSSE("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "thinking_delta",
          thinking: thinkingText,
        },
      });
    }

    case "tool_call":
      if (chunk.delta?.toolCall?.id) {
        // Track that we are sending a tool call
        // Note: We can't easily track state here as this function is stateless per chunk,
        // but we can infer "tool_use" stop reason if we see a tool call chunk.
        // For now, we rely on the upstream provider to set the stop reason, or we force it in the done handler if we could track state.
        // However, since we are stateless, we'll ensure the event structure is perfect.

        const toolCall = chunk.delta.toolCall;
        const toolUseId = toolCall.id;
        const toolName = toolCall.name;
        const toolArgs = toolCall.arguments || {};
        const jsonArgs = JSON.stringify(toolArgs);

        // 1. content_block_start
        const startEvent = formatSSE("content_block_start", {
          type: "content_block_start",
          index: 0, // Placeholder, updated by server/streaming.ts
          content_block: {
            type: "tool_use",
            id: toolUseId,
            name: toolName,
            input: {},
          },
        });

        // 2. content_block_delta (input_json_delta)
        // partial_json MUST be a string
        const inputEvent = formatSSE("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: jsonArgs,
          },
        });

        // 3. content_block_stop
        const stopEvent = formatSSE("content_block_stop", {
          type: "content_block_stop",
          index: 0,
        });

        return [startEvent, inputEvent, stopEvent];
      }
      return ""; // Should not happen for tool_call without id in this context

    case "usage":
      // Usage is often sent with the done signal or separately.
      // We'll send a message_delta.
      return formatSSE("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: null,
          stop_sequence: null,
        },
        usage: {
          output_tokens: chunk.usage?.outputTokens || 0,
        },
      });

    case "done":
      // When done, we MUST send message_delta with stop_reason if not sent yet, then message_stop.
      // Since we don't track state, we send message_delta here ensuring stop_reason is present.
      // If the upstream provided a stopReason, we use it.
      // Important: If we had a tool call, the stop reason SHOULD be "tool_use".
      // But we don't know if we had a tool call here easily without state.
      // We will blindly trust the provider's stopReason mapping, or default to "end_turn".

      const stopReason = chunk.stopReason || "end_turn";

      const msgDelta = formatSSE("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
        },
        usage: {
          output_tokens: chunk.usage?.outputTokens || 0,
        },
      });

      const msgStop = formatSSE("message_stop", {
        type: "message_stop",
      });

      return [msgDelta, msgStop];

    case "error":
      return formatSSE("error", {
        type: "error",
        error: {
          type: "server_error",
          message: chunk.error || "Unknown error",
        },
      });

    default:
      return "";
  }
}

function formatSSE(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}
