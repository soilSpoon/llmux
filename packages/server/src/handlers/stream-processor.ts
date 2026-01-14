import {
  createLogger,
  type FormatId,
  formatIdToProviderName,
  getFormat,
  getProvider,
  type ProviderName,
} from '@llmux/core'
import type { RequestFormat } from '../middleware/format'

export {
  type BlockType,
  createBlockStartEvent,
  createBlockStopEvent,
  createMessageStartEvent,
  detectBlockType,
  isEmptyTextBlock,
  patchStopReasonForToolUse,
} from './stream-helpers'

export interface StreamProcessorContext {
  reqId: string
  sourceFormat: RequestFormat
  parsingProvider: ProviderName
  shouldCacheSignatures: boolean
  signatureSessionKey?: string
  isThinkingEnabled?: boolean
}

export interface StreamBlockState {
  currentBlockType: 'thinking' | 'text' | 'tool_use' | 'stop' | null
  currentBlockIndex: number
  sentMessageStart: boolean
  thoughtBuffer: Map<number, string>
}

export interface StreamAccumulator {
  chunkCount: number
  totalBytes: number
  fullResponse: string
  accumulatedText: string
  accumulatedThinking: string
  accumulatedSignatures: string[]
}

const logger = createLogger({ service: 'stream-processor' })

export function transformStreamChunk(
  chunk: string,
  fromProvider: ProviderName | string,
  toFormat: RequestFormat | string
): string | string[] {
  const targetProviderName = formatIdToProviderName(toFormat as RequestFormat)

  // 1. Basic passthrough
  if (fromProvider === targetProviderName && !chunk.trim().startsWith('{')) return chunk
  if (chunk.trim() === 'data: [DONE]') return chunk
  if (!chunk.trim()) return chunk === '\n\n' ? '\n' : chunk

  try {
    // 2. Resolve source format ID
    let sourceFormatId: FormatId = 'openai-chat'
    if (fromProvider === 'anthropic') {
      sourceFormatId = 'anthropic-messages'
    } else if (fromProvider === 'openai') {
      sourceFormatId = 'openai-chat'
    } else if (fromProvider === 'gemini' || fromProvider === 'antigravity') {
      sourceFormatId = 'google-gemini'
    } else {
      // Fallback to provider lookup
      try {
        const provider = getProvider(fromProvider as ProviderName)
        sourceFormatId = provider.getFormatForModel?.('unknown') ?? 'openai-chat'
      } catch {
        // Ultimate fallback: detect from chunk content
        if (
          chunk.includes('"type":"message_delta"') ||
          chunk.includes('"type":"content_block_delta"')
        ) {
          sourceFormatId = 'anthropic-messages'
        } else if (chunk.includes('"candidates"')) {
          sourceFormatId = 'google-gemini'
        }
      }
    }

    const sourceFormat = getFormat(sourceFormatId)
    const targetFormat = getFormat(toFormat as FormatId)

    if (!sourceFormat.parseStreamChunk || !targetFormat.buildStreamChunk) {
      return chunk
    }

    const unified = sourceFormat.parseStreamChunk(chunk)

    if (!unified) {
      if (chunk.trim().startsWith('{')) return ''
      return chunk
    }

    const chunks = Array.isArray(unified) ? unified : [unified]
    const results: string[] = []

    for (const c of chunks) {
      const built = targetFormat.buildStreamChunk(c, {
        provider: targetProviderName,
        model: 'unknown',
      })
      if (typeof built === 'string') {
        results.push(built)
      } else if (Array.isArray(built)) {
        results.push(...built)
      }
    }

    if (results.length === 0) return ''
    if (results.length === 1) return results[0] as string
    return results
  } catch (error) {
    logger.warn(
      { error: String(error), fromProvider, toFormat },
      'Failed to transform stream chunk'
    )
    return chunk
  }
}

export function getParserType(provider: ProviderName): 'sse-standard' | 'sse-line-delimited' {
  try {
    const providerConfig = getProvider(provider)
    if (providerConfig.config.defaultStreamParser) {
      return providerConfig.config.defaultStreamParser
    }
  } catch (error) {
    logger.warn(
      { provider, error: String(error) },
      'Failed to get provider config for stream parser'
    )
  }
  // Default to sse-standard
  return 'sse-standard'
}

export function splitSSEEvents(
  buffer: string,
  parserType: 'sse-standard' | 'sse-line-delimited',
  newText: string
): { events: string[]; remaining: string } {
  if (parserType === 'sse-line-delimited') {
    const lines = buffer.split('\n')
    const events: string[] = []
    const lastLineIncomplete = !newText.endsWith('\n')
    const linesToProcess = lastLineIncomplete ? lines.slice(0, -1) : lines
    const remainingLine = lastLineIncomplete ? (lines[lines.length - 1] ?? '') : ''

    for (const line of linesToProcess) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        events.push(line)
      }
    }
    return { events, remaining: remainingLine }
  }

  const events = buffer.split('\n\n')
  if (!buffer.endsWith('\n\n')) {
    const remaining = events.pop() || ''
    return { events, remaining }
  }
  return { events, remaining: '' }
}

export function updateChunkIndex(chunk: string, newIndex: number): string {
  try {
    const lines = chunk.trim().split('\n')
    const dataLineIndex = lines.findIndex((line) => line.startsWith('data: '))
    if (dataLineIndex !== -1) {
      const line = lines[dataLineIndex]
      if (line) {
        const dataContent = line.slice(6)
        if (dataContent.trim() !== '[DONE]') {
          try {
            const json = JSON.parse(dataContent)
            if (typeof json === 'object' && json !== null && 'index' in json) {
              json.index = newIndex
              lines[dataLineIndex] = `data: ${JSON.stringify(json)}`
              return `${lines.join('\n')}\n\n`
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return chunk
}

export function extractContentFromChunk(chunk: string): { text?: string; thinking?: string } {
  const result: { text?: string; thinking?: string } = {}
  try {
    const lines = chunk.trim().split('\n')
    const dataLineIndex = lines.findIndex((line) => line.startsWith('data: '))
    if (dataLineIndex !== -1) {
      const line = lines[dataLineIndex]
      if (line) {
        const dataContent = line.slice(6)
        if (dataContent.trim() !== '[DONE]') {
          const json = JSON.parse(dataContent)

          // Anthropic format (content_block_delta)
          if (json.type === 'content_block_delta' && json.delta) {
            if (typeof json.delta.text === 'string') result.text = json.delta.text
            if (typeof json.delta.thinking === 'string') result.thinking = json.delta.thinking
          }
          // Anthropic format (content_block_start)
          else if (json.type === 'content_block_start' && json.content_block) {
            if (typeof json.content_block.text === 'string') result.text = json.content_block.text
            if (typeof json.content_block.thinking === 'string')
              result.thinking = json.content_block.thinking
          }
          // OpenAI Chat Completions format (chat.completion.chunk with delta.content)
          else if (json.object === 'chat.completion.chunk' && Array.isArray(json.choices)) {
            for (const choice of json.choices) {
              if (choice.delta?.content) {
                result.text = (result.text || '') + choice.delta.content
              }
            }
          }
          // OpenAI Responses API format
          else if (json.type === 'response.text.delta') {
            if (typeof json.delta === 'string') {
              result.text = json.delta
            }
          } else if (json.type === 'response.reasoning_summary_text.delta') {
            if (typeof json.delta === 'string') {
              result.thinking = json.delta
            }
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return result
}
