import { createLogger, getProvider, type ProviderName, type StreamChunk } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { normalizeBashArguments } from './bash-normalization'
import { cacheSignatureFromChunk } from './signature-integration'

const logger = createLogger({ service: 'stream-processor' })

export type BlockType = 'thinking' | 'text' | 'tool_use' | 'stop' | null

export interface StreamProcessorContext {
  reqId: string
  sourceFormat: RequestFormat
  parsingProvider: ProviderName
  shouldCacheSignatures: boolean
  signatureSessionKey?: string
  isThinkingEnabled?: boolean
}

export interface StreamBlockState {
  currentBlockType: BlockType
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
  if (fromProvider === toFormat && !chunk.trim().startsWith('{')) return chunk

  if (chunk.trim() === 'data: [DONE]') {
    return chunk
  }

  if (!chunk.trim()) {
    return chunk === '\n\n' ? '\n' : chunk
  }

  try {
    const sourceProvider = getProvider(fromProvider)
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
        fromProvider === 'antigravity'
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
      fromProvider === 'antigravity' ? applyBashNormalizationToChunk(unified) : unified

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

export function detectBlockType(sse: string): BlockType {
  if (sse.includes('"type":"message_stop"') || sse.includes('"type":"message_delta"')) {
    return 'stop'
  }

  if (sse.includes('"type":"content_block_start"')) {
    if (sse.includes('"thinking"')) return 'thinking'
    if (sse.includes('"text"')) return 'text'
    if (sse.includes('"tool_use"')) return 'tool_use'
  }

  if (
    sse.includes('"type":"thinking_delta"') ||
    sse.includes('"type":"signature_delta"') ||
    sse.includes('"type":"thinking"')
  ) {
    return 'thinking'
  }
  if (sse.includes('"type":"text_delta"') || sse.includes('"type":"text"')) {
    return 'text'
  }
  if (sse.includes('"type":"tool_use"')) {
    return 'tool_use'
  }
  if (sse.includes('"type":"input_json_delta"')) {
    return 'tool_use'
  }
  return null
}

export function createBlockStartEvent(
  blockType: 'thinking' | 'text' | 'tool_use' | 'stop',
  index: number
): string | null {
  if (blockType === 'thinking') {
    return `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`
  }
  if (blockType === 'text') {
    return `event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}\n\n`
  }
  if (blockType === 'tool_use') {
    logger.error(
      { index, blockType },
      '[stream-processor] CRITICAL: Attempted to start tool_use block implicitly without ID/Name'
    )
    return null
  }
  return null
}

export function createBlockStopEvent(index: number): string {
  return `event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`
}

export function createMessageStartEvent(): string {
  const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
  return `event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
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

export function isEmptyTextBlock(chunk: string): boolean {
  const textMatch = chunk.match(/"text":"((?:[^"\\]|\\.)*)"/g)
  return textMatch?.every((m) => m === '"text":""' || m === '"text": ""') ?? false
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

export function cacheSignatureFromSSEChunk(
  chunk: string,
  signatureSessionKey: string,
  thoughtBuffer: Map<number, string>,
  currentBlockIndex: number,
  contextHash?: string
): void {
  try {
    const lines = chunk.trim().split('\n')
    const dataLine = lines.find((line) => line.startsWith('data: '))
    if (!dataLine) return

    const dataContent = dataLine.slice(6)
    if (dataContent.trim() === '[DONE]') return

    const json = JSON.parse(dataContent)

    let thinking: string | undefined
    let signature: string | undefined

    // Handle standard Anthropic streaming format
    if (json.type === 'content_block_delta' && json.delta) {
      if (typeof json.delta.thinking === 'string') thinking = json.delta.thinking
      if (typeof json.delta.signature === 'string') signature = json.delta.signature
    } else if (json.type === 'content_block_start' && json.content_block) {
      if (typeof json.content_block.thinking === 'string') thinking = json.content_block.thinking
      if (typeof json.content_block.signature === 'string') signature = json.content_block.signature
    }
    // Fallback: Check for top-level properties (legacy or other formats)
    else {
      if (typeof json.thinking === 'string') thinking = json.thinking
      if (typeof json.signature === 'string') signature = json.signature
    }

    if (thinking || signature) {
      cacheSignatureFromChunk(
        signatureSessionKey,
        {
          thinking: {
            text: thinking,
            signature: signature,
          },
        },
        thoughtBuffer,
        currentBlockIndex,
        contextHash
      )
    }
  } catch {
    // Fallback to regex if JSON parsing fails (e.g. malformed data),
    // but use a robust regex that handles escaped quotes
    const thinkingMatch = chunk.match(/"thinking"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
    const signatureMatch = chunk.match(/"signature"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]

    if (thinkingMatch || signatureMatch) {
      // Unescape the regex match to get actual string content
      const unescapeStr = (s: string | undefined) => (s ? s.replace(/\\(["\\])/g, '$1') : undefined)

      cacheSignatureFromChunk(
        signatureSessionKey,
        {
          thinking: {
            text: unescapeStr(thinkingMatch),
            signature: unescapeStr(signatureMatch),
          },
        },
        thoughtBuffer,
        currentBlockIndex,
        contextHash
      )
    }
  }
}

export function patchStopReasonForToolUse(chunk: string): string {
  return chunk.replace(/"stop_reason":"end_turn"/g, '"stop_reason":"tool_use"')
}
