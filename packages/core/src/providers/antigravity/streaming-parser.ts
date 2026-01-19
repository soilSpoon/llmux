import crypto from 'node:crypto'
import { decodeAntigravityToolName } from '../../schema/reversible-tool-name'
import type { StreamChunk } from '../../types/unified'
import { mapToStopReason } from './streaming-utils'

export interface AntigravityParserState {
  currentBlockType: 'thinking' | 'text' | 'tool_use' | null
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

      const parsed = JSON.parse(cleaned) as Record<string, unknown>

      // 1. Detect Anthropic-style SSE event
      if (parsed.type && typeof parsed.type === 'string') {
        this.state.detectedFormat = 'anthropic'

        if (parsed.type === 'message_start') {
          const message = parsed.message as Record<string, unknown>
          const usage = message?.usage as Record<string, unknown>
          return {
            type: 'usage',
            usage: {
              inputTokens: (usage?.input_tokens as number) || 0,
              outputTokens: (usage?.output_tokens as number) || 0,
            },
          }
        }

        if (parsed.type === 'content_block_start') {
          const contentBlock = parsed.content_block as Record<string, unknown>
          const blockType = contentBlock?.type as string
          const index = (parsed.index as number) || 0

          this.state.currentBlockType = blockType as 'thinking' | 'text' | 'tool_use'
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
            const id = (contentBlock?.id as string) || `call_${crypto.randomUUID()}`
            // Ensure we decode the tool name just like we do for Gemini format
            const rawName = (contentBlock?.name as string) || 'unknown'
            const name = decodeAntigravityToolName(rawName)

            return {
              type: 'tool-call-start',
              toolCall: { id, name },
              blockIndex: index,
            }
          }
          return null
        }

        if (parsed.type === 'content_block_delta') {
          const delta = parsed.delta as Record<string, unknown>
          const deltaType = delta?.type as string
          const index = (parsed.index as number) || 0

          if (deltaType === 'text_delta') {
            return {
              type: 'text-delta',
              delta: { text: (delta?.text as string) || '' },
              blockIndex: index,
            }
          }
          if (deltaType === 'thinking_delta') {
            return {
              type: 'thinking-delta',
              delta: {
                thinking: {
                  text: (delta?.thinking as string) || '',
                },
              },
              blockIndex: index,
            }
          }
          if (deltaType === 'input_json_delta') {
            return {
              type: 'tool-input-delta',
              delta: { partialJson: (delta?.partial_json as string) || '' },
              blockIndex: index,
            }
          }
          return null
        }

        if (parsed.type === 'content_block_stop') {
          const index = (parsed.index as number) || 0

          // If the current block was a tool use, we MUST emit tool-call-end
          // so that the pipeline knows the tool call is complete.
          if (this.state.currentBlockType === 'tool_use') {
            this.state.currentBlockType = null // Reset
            return {
              type: 'tool-call-end',
              blockIndex: index,
            }
          }

          // For other blocks (text, thinking), generic block_stop is fine
          // (or could be specific if StreamChunk supports it)
          this.state.currentBlockType = null // Reset
          return { type: 'block_stop', blockIndex: index }
        }

        if (parsed.type === 'message_delta') {
          const deltaObj = parsed.delta as Record<string, unknown>
          const rawReason = (deltaObj?.stop_reason as string) || 'end_turn'
          const unifiedReason = mapToStopReason(rawReason)
          const usage = parsed.usage as Record<string, unknown>

          // Store finish state for flush()
          this.state.finishReason = rawReason
          if (usage) {
            this.state.finalUsage = {
              inputTokens: 0,
              outputTokens: (usage.output_tokens as number) || 0,
            }
          }

          return {
            type: 'finish',
            finishReason: { unified: unifiedReason, raw: rawReason },
            usage: usage
              ? {
                  inputTokens: 0,
                  outputTokens: (usage.output_tokens as number) || 0,
                }
              : undefined,
          }
        }

        if (parsed.type === 'message_stop') {
          return {
            type: 'finish',
            finishReason: { unified: 'end_turn', raw: 'message_stop' },
          }
        }

        return null
      }

      // 2. Check for Antigravity/Gemini wrapped format
      this.state.detectedFormat = 'gemini'

      let geminiChunk = parsed
      if (parsed.response && typeof parsed.response === 'object') {
        geminiChunk = parsed.response as Record<string, unknown>
      }

      // If it looks like Gemini candidates
      if (geminiChunk.candidates && Array.isArray(geminiChunk.candidates)) {
        const candidate = geminiChunk.candidates[0] as Record<string, unknown> | undefined
        if (!candidate) return null

        const chunks: StreamChunk[] = []
        const content = candidate.content as Record<string, unknown> | undefined
        if (content?.parts && Array.isArray(content.parts)) {
          for (const part of content.parts) {
            const p = part as Record<string, unknown>
            if (p.text !== undefined && typeof p.text === 'string') {
              // If it has thought (or thought_signature in snake_case wire format), it's thinking delta
              if (p.thought || p.thought_signature || p.thoughtSignature) {
                chunks.push({
                  type: 'thinking-delta',
                  delta: {
                    thinking: {
                      text: p.text,
                    },
                  },
                })
              } else {
                chunks.push({
                  type: 'text-delta',
                  delta: { text: p.text },
                })
              }
            } else if (p.functionCall && typeof p.functionCall === 'object') {
              const fc = p.functionCall as Record<string, unknown>
              chunks.push({
                type: 'tool-call-start',
                toolCall: {
                  id: (fc.id as string) || `call_${crypto.randomUUID()}`,
                  name: decodeAntigravityToolName((fc.name as string) || 'unknown'),
                },
              })
              const argsStr =
                typeof fc.args === 'string' ? (fc.args as string) : JSON.stringify(fc.args)
              chunks.push({
                type: 'tool-input-delta',
                delta: { partialJson: argsStr },
              })
              chunks.push({ type: 'tool-call-end' })
            }
          }
        }

        if (candidate.finishReason && typeof candidate.finishReason === 'string') {
          const unifiedReason = mapToStopReason(candidate.finishReason)
          // Store finish state for flush()
          this.state.finishReason = candidate.finishReason
          chunks.push({
            type: 'finish',
            finishReason: { unified: unifiedReason, raw: candidate.finishReason },
          })
        }

        const usageMetadata = geminiChunk.usageMetadata as Record<string, unknown> | undefined
        if (usageMetadata) {
          // Store final usage for flush()
          this.state.finalUsage = {
            inputTokens: (usageMetadata.promptTokenCount as number) || 0,
            outputTokens: (usageMetadata.candidatesTokenCount as number) || 0,
          }
          chunks.push({
            type: 'usage',
            usage: this.state.finalUsage,
          })
        }

        return chunks.length > 0 ? chunks : null
      }

      return null
    } catch {
      return null
    }
  }
}
