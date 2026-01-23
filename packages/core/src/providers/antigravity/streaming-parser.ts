import crypto from 'node:crypto'
import type { AnthropicStreamEvent } from '../../formats/anthropic-messages/types'
import { parseGeminiStreamChunk } from '../../formats/gemini/streaming/parser'
import type { StreamChunk } from '../../types/unified'
import { ToolNameCodec } from '../../util/tool-name-codec'
import { mapToStopReason } from './streaming-utils'

export interface AntigravityParserState {
  currentBlockType: 'thinking' | 'text' | 'tool_use' | 'redacted_thinking' | null
  currentBlockIndex: number
  hasToolUseBlock: boolean
  detectedFormat: 'anthropic' | 'gemini' | null
  finishReason: string | null
  finalUsage: { inputTokens: number; outputTokens: number } | null
}

export class AntigravityStreamingParser {
  private state: AntigravityParserState

  constructor(state: AntigravityParserState) {
    this.state = state
  }

  parse(chunk: string): StreamChunk | StreamChunk[] | null {
    try {
      if (!chunk || chunk.trim() === 'data: [DONE]') {
        return null
      }

      const cleaned = chunk.replace(/^data:\s*/, '').trim()
      if (!cleaned) {
        return null
      }

      const parsed = JSON.parse(cleaned)

      // 1. Detect Anthropic-style SSE event
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        typeof parsed.type === 'string'
      ) {
        this.state.detectedFormat = 'anthropic'
        const event = parsed as AnthropicStreamEvent

        if (event.type === 'message_start') {
          const usage = event.message.usage
          return {
            type: 'usage',
            usage: {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
            },
          }
        }

        if (event.type === 'content_block_start') {
          const contentBlock = event.content_block
          const blockType = contentBlock.type
          const index = event.index

          this.state.currentBlockType = blockType
          this.state.currentBlockIndex = index

          if (blockType === 'text') {
            return {
              type: 'text-delta',
              delta: { text: '' },
              blockIndex: index,
            }
          }
          if (blockType === 'thinking') {
            return {
              type: 'thinking-start',
              blockIndex: index,
            }
          }
          if (blockType === 'tool_use') {
            this.state.hasToolUseBlock = true
            const id = contentBlock.id || `call_${crypto.randomUUID()}`
            const codec = new ToolNameCodec()
            const name = codec.decode(contentBlock.name || 'unknown')

            return {
              type: 'tool-call-start',
              toolCall: { id, name },
              blockIndex: index,
            }
          }
          return null
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta
          const index = event.index

          if (delta.type === 'text_delta') {
            return {
              type: 'text-delta',
              delta: { text: delta.text || '' },
              blockIndex: index,
            }
          }
          if (delta.type === 'thinking_delta') {
            return {
              type: 'thinking-delta',
              delta: {
                thinking: {
                  text: delta.thinking || '',
                },
              },
              blockIndex: index,
            }
          }
          if (delta.type === 'input_json_delta') {
            return {
              type: 'tool-input-delta',
              delta: { partialJson: delta.partial_json || '' },
              blockIndex: index,
            }
          }
          return null
        }

        if (event.type === 'content_block_stop') {
          const index = event.index
          if (this.state.currentBlockType === 'tool_use') {
            this.state.currentBlockType = null
            return {
              type: 'tool-call-end',
              blockIndex: index,
            }
          }
          this.state.currentBlockType = null
          return { type: 'block_stop', blockIndex: index }
        }

        if (event.type === 'message_delta') {
          const rawReason = event.delta.stop_reason || 'end_turn'
          const unifiedReason = mapToStopReason(rawReason)
          const usage = event.usage

          this.state.finishReason = rawReason
          if (usage) {
            this.state.finalUsage = {
              inputTokens: 0,
              outputTokens: usage.output_tokens || 0,
            }
          }

          return {
            type: 'finish',
            finishReason: { unified: unifiedReason, raw: rawReason },
            usage: usage ? { inputTokens: 0, outputTokens: usage.output_tokens || 0 } : undefined,
          }
        }

        if (event.type === 'message_stop') {
          return {
            type: 'finish',
            finishReason: { unified: 'end_turn', raw: 'message_stop' },
          }
        }

        return null
      }

      // 2. Check for Antigravity/Gemini wrapped format
      const chunks = parseGeminiStreamChunk(parsed)
      if (chunks) {
        this.state.detectedFormat = 'gemini'

        for (const chunk of chunks) {
          if (chunk.type === 'usage' && chunk.usage) {
            this.state.finalUsage = chunk.usage
          }
          if (chunk.type === 'finish' && chunk.finishReason) {
            this.state.finishReason = chunk.finishReason.raw
          }
        }

        return chunks
      }

      return null
    } catch {
      return null
    }
  }
}
