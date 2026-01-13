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

const logger = createLogger({ service: 'stream-processor' })

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

export function transformStreamChunk(
  chunk: string,
  fromProvider: ProviderName,
  toFormat: RequestFormat
): string | string[] {
  const targetProviderName = formatIdToProviderName(toFormat)

  if (fromProvider === targetProviderName && !chunk.trim().startsWith('{')) return chunk

  if (chunk.trim() === 'data: [DONE]') {
    return chunk
  }

  if (!chunk.trim()) {
    return chunk === '\n\n' ? '\n' : chunk
  }

  try {
    // Use provider to get format ID
    const sourceProvider = getProvider(fromProvider)
    const sourceFormatId = sourceProvider.getFormatForModel?.('unknown') ?? 'openai-chat'
    const sourceFormat = getFormat(sourceFormatId)
    const targetFormat = getFormat(toFormat as FormatId)

    if (!sourceFormat.parseStreamChunk || !targetFormat.buildStreamChunk) {
      return chunk
    }

    const unified = sourceFormat.parseStreamChunk(chunk)

    if (!unified) {
      if (chunk.trim().startsWith('{')) {
        return ''
      }
      return chunk
    }

    if (Array.isArray(unified)) {
      return unified
        .flatMap((c) =>
          targetFormat.buildStreamChunk?.(c, {
            provider: targetProviderName,
            model: 'unknown',
          })
        )
        .filter((v): v is string => v !== undefined)
    }

    if (unified.type === 'error') {
      return chunk
    }

    const result = targetFormat.buildStreamChunk(unified, {
      provider: targetProviderName,
      model: 'unknown',
    })
    return result
  } catch (error) {
    logger.error(
      {
        fromProvider,
        toFormat,
        error: error instanceof Error ? error.message : String(error),
        chunkSample: chunk.slice(0, 200),
      },
      'Error transforming stream chunk'
    )
    return ''
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
