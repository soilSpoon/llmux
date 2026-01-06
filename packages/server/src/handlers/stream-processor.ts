import { createLogger, getProvider, type ProviderName, type StreamChunk } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { normalizeBashArguments } from './bash-normalization'

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
}

function applyBashNormalizationToChunk(chunk: StreamChunk): StreamChunk {
  if (chunk.type !== 'tool_call' || !chunk.delta?.toolCall) {
    return chunk
  }

  const toolCall = chunk.delta.toolCall
  if (!toolCall.name || !toolCall.arguments || typeof toolCall.arguments !== 'object') {
    return chunk
  }

  const normalizedArgs = normalizeBashArguments(
    toolCall.name,
    toolCall.arguments as Record<string, unknown>
  )

  if (normalizedArgs === toolCall.arguments) {
    return chunk
  }

  logger.trace(
    { toolName: toolCall.name, originalArgs: toolCall.arguments, normalizedArgs },
    '[stream-processor] Bash argument normalization applied'
  )

  return {
    ...chunk,
    delta: {
      ...chunk.delta,
      toolCall: { ...toolCall, arguments: normalizedArgs },
    },
  }
}

export function transformStreamChunk(
  chunk: string,
  fromProvider: ProviderName,
  toFormat: RequestFormat
): string | string[] {
  const effectiveFromProvider = fromProvider === 'gemini-cli' ? 'antigravity' : fromProvider

  if (effectiveFromProvider === toFormat && !chunk.trim().startsWith('{')) return chunk

  if (chunk.trim() === 'data: [DONE]') {
    return chunk
  }

  if (!chunk.trim()) {
    return chunk === '\n\n' ? '\n' : chunk
  }

  try {
    const sourceProvider = getProvider(effectiveFromProvider)
    const targetProvider = getProvider(toFormat as ProviderName)

    if (!sourceProvider.parseStreamChunk || !targetProvider.transformStreamChunk) {
      return chunk
    }

    const unified = sourceProvider.parseStreamChunk(chunk)

    if (!unified) {
      if (chunk.trim().startsWith('{')) {
        return ''
      }
      return chunk
    }

    if (Array.isArray(unified)) {
      const normalized =
        effectiveFromProvider === 'antigravity'
          ? unified.map((c) => applyBashNormalizationToChunk(c))
          : unified
      return normalized
        .map((c) => targetProvider.transformStreamChunk?.(c))
        .filter((v): v is string => v !== undefined)
    }

    if (unified.type === 'error') {
      return chunk
    }

    const normalizedChunk =
      effectiveFromProvider === 'antigravity' ? applyBashNormalizationToChunk(unified) : unified

    const result = targetProvider.transformStreamChunk(normalizedChunk)
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
    if (providerConfig?.config?.defaultStreamParser) {
      return providerConfig.config.defaultStreamParser as 'sse-standard' | 'sse-line-delimited'
    }
  } catch {
    // Ignore
  }
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
      if (line.startsWith('data:')) {
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
          if (json.type === 'content_block_delta' && json.delta) {
            if (typeof json.delta.text === 'string') result.text = json.delta.text
            if (typeof json.delta.thinking === 'string') result.thinking = json.delta.thinking
          } else if (json.type === 'content_block_start' && json.content_block) {
            if (typeof json.content_block.text === 'string') result.text = json.content_block.text
            if (typeof json.content_block.thinking === 'string')
              result.thinking = json.content_block.thinking
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return result
}
