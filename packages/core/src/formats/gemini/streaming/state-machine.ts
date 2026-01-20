import type { JsonObject } from 'type-fest'
import { ToolNameCodec } from '../../../util/tool-name-codec.js'

/**
 * US-010: Streaming State Machine
 */

export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'thought'; text: string; signature?: string }
  | { type: 'tool_call'; id?: string; name?: string; args: string }
  | { type: 'done'; reason?: string }

export type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: JsonObject } }
  | { type: 'finish'; reason: string; usage?: { inputTokens: number; outputTokens: number } }

type State = 'idle' | 'thinking' | 'text' | 'tool'

export class StreamingStateMachine {
  private state: State = 'idle'
  private codec = new ToolNameCodec()

  // Buffers
  private toolBuffer: { id: string; name: string; args: string } | null = null

  process(event: StreamEvent): StreamChunk[] {
    const chunks: StreamChunk[] = []

    switch (event.type) {
      case 'content':
        if (this.state === 'tool') {
          this.flushTool(chunks)
        }
        this.state = 'text'
        if (event.text) {
          chunks.push({ type: 'text-delta', text: event.text })
        }
        break

      case 'thought':
        if (this.state === 'tool') {
          this.flushTool(chunks)
        }
        this.state = 'thinking'
        if (event.text) {
          chunks.push({ type: 'thinking-delta', text: event.text })
        }
        break

      case 'tool_call':
        this.state = 'tool'
        if (!this.toolBuffer) {
          this.toolBuffer = {
            id: event.id || 'unknown',
            name: event.name || '',
            args: '',
          }
        }
        if (event.args) {
          this.toolBuffer.args += event.args
        }
        break

      case 'done': {
        const hasToolCalls = this.state === 'tool' || !!this.toolBuffer
        if (this.state === 'tool' || this.toolBuffer) {
          this.flushTool(chunks)
        }
        chunks.push({
          type: 'finish',
          reason: hasToolCalls ? 'tool_calls' : event.reason || 'stop',
        })
        break
      }
    }

    return chunks
  }

  private flushTool(chunks: StreamChunk[]) {
    if (this.toolBuffer) {
      try {
        const decodedName = this.codec.decode(this.toolBuffer.name)
        const args = JSON.parse(this.toolBuffer.args)
        chunks.push({
          type: 'tool_call',
          toolCall: {
            id: this.toolBuffer.id,
            name: decodedName,
            arguments: args,
          },
        })
      } catch (e) {
        console.error('Failed to parse tool args', e)
        // Optionally emit error or partial
      }
      this.toolBuffer = null
    }
  }
}
