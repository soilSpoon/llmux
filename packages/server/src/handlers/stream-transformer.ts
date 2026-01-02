import { createLogger, type ProviderName } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import {
  type BlockType,
  cacheSignatureFromSSEChunk,
  createBlockStartEvent,
  createBlockStopEvent,
  createMessageStartEvent,
  detectBlockType,
  extractContentFromChunk,
  getParserType,
  isEmptyTextBlock,
  patchStopReasonForToolUse,
  splitSSEEvents,
  transformStreamChunk,
  updateChunkIndex,
} from './stream-processor'

const logger = createLogger({ service: 'stream-transformer' })

export interface StreamContext {
  reqId: string
  fromFormat: RequestFormat
  targetProvider: string
  targetModel: string
  originalModel: string
  finalModel: string
  chunkCount: number
  totalBytes: number
  duration: number
  error?: string
  requestInfo?: {
    model: string
    provider: string
    endpoint: string
    toolsCount: number
    bodyLength: number
  }
  fullResponse: string
  accumulatedText: string
  accumulatedThinking: string
}

export interface StreamTransformerOptions {
  reqId: string
  startTime: number
  sourceFormat: RequestFormat
  targetProvider: ProviderName
  streamContext: StreamContext
  shouldCacheSignaturesForModel: boolean
  signatureSessionKey?: string
  contextHash?: string
}

export function createStreamTransformer(options: StreamTransformerOptions) {
  const {
    startTime,
    sourceFormat,
    targetProvider,
    streamContext,
    shouldCacheSignaturesForModel,
    signatureSessionKey,
    contextHash,
  } = options

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''

  let currentBlockType: BlockType = null
  let currentBlockIndex = 0
  const thoughtBuffer = new Map<number, string>()
  let messageStartSent = false

  // provider might change based on protocol resolution, but here we assume targetProvider is effective
  const parsingProvider = targetProvider
  let parserType = getParserType(parsingProvider)

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true })
      streamContext.totalBytes += text.length
      buffer += text

      parserType = getParserType(parsingProvider)
      const { events: rawEvents, remaining } = splitSSEEvents(buffer, parserType, text)
      buffer = remaining

      for (const rawEvent of rawEvents) {
        if (!rawEvent.trim()) continue

        logger.trace(
          { rawEvent, currentBlockType, currentBlockIndex },
          '[streaming] Processing raw SSE event'
        )

        const eventWithNewline = `${rawEvent}\n\n`
        try {
          const transformed = transformStreamChunk(eventWithNewline, parsingProvider, sourceFormat)

          const processChunk = (
            chunkStr: string,
            ctrl: TransformStreamDefaultController<Uint8Array>
          ) => {
            if (!chunkStr.trim()) return

            const chunkBlockType = detectBlockType(chunkStr)
            const isBlockStart = chunkStr.includes('"type":"content_block_start"')
            const isBlockStop = chunkStr.includes('"type":"content_block_stop"')
            const isMessageStart = chunkStr.includes('"type":"message_start"')

            if (sourceFormat === 'anthropic') {
              // Ensure message_start is sent before any content_block_start
              if (!messageStartSent && !isMessageStart) {
                // Check if this is actual content (not just ping/error)
                if (chunkBlockType || isBlockStart) {
                  ctrl.enqueue(encoder.encode(createMessageStartEvent()))
                  messageStartSent = true
                }
              }
              if (isMessageStart) {
                messageStartSent = true
              }
              if (chunkBlockType === 'stop') {
                let finalChunk = chunkStr
                if (currentBlockType !== null) {
                  if (currentBlockType === 'tool_use') {
                    finalChunk = patchStopReasonForToolUse(finalChunk)
                  }
                  ctrl.enqueue(encoder.encode(createBlockStopEvent(currentBlockIndex)))
                  currentBlockType = null
                }
                streamContext.fullResponse += finalChunk
                ctrl.enqueue(encoder.encode(finalChunk))
                return
              }

              if (isBlockStart) {
                if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return
                if (currentBlockType !== null) {
                  ctrl.enqueue(encoder.encode(createBlockStopEvent(currentBlockIndex)))
                  currentBlockIndex++
                }
                if (chunkBlockType) currentBlockType = chunkBlockType
              } else if (chunkBlockType && chunkBlockType !== currentBlockType) {
                if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return
                if (currentBlockType !== null) {
                  ctrl.enqueue(encoder.encode(createBlockStopEvent(currentBlockIndex)))
                  currentBlockIndex++
                }
                const startEvent = createBlockStartEvent(chunkBlockType, currentBlockIndex)
                if (startEvent) ctrl.enqueue(encoder.encode(startEvent))
                currentBlockType = chunkBlockType
              } else if (currentBlockType === null && chunkBlockType) {
                if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return
                const startEvent = createBlockStartEvent(chunkBlockType, currentBlockIndex)
                if (startEvent) ctrl.enqueue(encoder.encode(startEvent))
                currentBlockType = chunkBlockType
              }
            }

            if (
              shouldCacheSignaturesForModel &&
              signatureSessionKey &&
              (chunkBlockType === 'thinking' || currentBlockType === 'thinking')
            ) {
              cacheSignatureFromSSEChunk(
                chunkStr,
                signatureSessionKey,
                thoughtBuffer,
                currentBlockIndex,
                contextHash
              )
            }

            const updatedChunk = updateChunkIndex(chunkStr, currentBlockIndex)
            const content = extractContentFromChunk(chunkStr)
            if (content.text) streamContext.accumulatedText += content.text
            if (content.thinking) streamContext.accumulatedThinking += content.thinking

            streamContext.chunkCount++
            streamContext.fullResponse += updatedChunk
            ctrl.enqueue(encoder.encode(updatedChunk))

            if (sourceFormat === 'anthropic' && (isBlockStop || chunkBlockType === 'stop')) {
              currentBlockType = null
              currentBlockIndex++
            }
          }

          if (Array.isArray(transformed)) {
            for (const t of transformed) {
              processChunk(t, controller)
            }
          } else if (transformed) {
            processChunk(transformed, controller)
          }
        } catch (error) {
          logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            'Stream chunk transform error'
          )
          throw error
        }
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        const events = buffer.split('\n\n').filter((e) => e.trim())
        for (const event of events) {
          const eventWithNewline = `${event}\n\n`
          try {
            const transformed = transformStreamChunk(
              eventWithNewline,
              parsingProvider,
              sourceFormat
            )

            const processChunk = (
              chunkStr: string,
              ctrl: TransformStreamDefaultController<Uint8Array>
            ) => {
              if (!chunkStr.trim()) return

              const chunkBlockType = detectBlockType(chunkStr)
              const isBlockStart = chunkStr.includes('"type":"content_block_start"')
              const isBlockStop = chunkStr.includes('"type":"content_block_stop"')

              if (sourceFormat === 'anthropic') {
                if (chunkBlockType === 'stop') {
                  let finalChunk = chunkStr
                  if (currentBlockType !== null) {
                    if (currentBlockType === 'tool_use') {
                      finalChunk = patchStopReasonForToolUse(finalChunk)
                    }
                    ctrl.enqueue(encoder.encode(createBlockStopEvent(currentBlockIndex)))
                    currentBlockType = null
                  }
                  ctrl.enqueue(encoder.encode(finalChunk))
                  return
                }

                if (isBlockStart) {
                  if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return
                  if (currentBlockType !== null) {
                    ctrl.enqueue(encoder.encode(createBlockStopEvent(currentBlockIndex)))
                    currentBlockIndex++
                  }
                  if (chunkBlockType) currentBlockType = chunkBlockType
                } else if (chunkBlockType && chunkBlockType !== currentBlockType) {
                  if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return
                  if (currentBlockType !== null) {
                    ctrl.enqueue(encoder.encode(createBlockStopEvent(currentBlockIndex)))
                    currentBlockIndex++
                  }
                  const startEvent = createBlockStartEvent(chunkBlockType, currentBlockIndex)
                  if (startEvent) ctrl.enqueue(encoder.encode(startEvent))
                  currentBlockType = chunkBlockType
                } else if (currentBlockType === null && chunkBlockType) {
                  if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return
                  const startEvent = createBlockStartEvent(chunkBlockType, currentBlockIndex)
                  if (startEvent) ctrl.enqueue(encoder.encode(startEvent))
                  currentBlockType = chunkBlockType
                }
              }

              if (
                shouldCacheSignaturesForModel &&
                signatureSessionKey &&
                (chunkBlockType === 'thinking' || currentBlockType === 'thinking')
              ) {
                cacheSignatureFromSSEChunk(
                  chunkStr,
                  signatureSessionKey,
                  thoughtBuffer,
                  currentBlockIndex,
                  contextHash
                )
              }

              const updatedChunk = updateChunkIndex(chunkStr, currentBlockIndex)
              streamContext.chunkCount++
              streamContext.fullResponse += updatedChunk
              ctrl.enqueue(encoder.encode(updatedChunk))

              if (sourceFormat === 'anthropic' && (isBlockStop || chunkBlockType === 'stop')) {
                currentBlockType = null
                currentBlockIndex++
              }
            }

            if (Array.isArray(transformed)) {
              for (const t of transformed) {
                processChunk(t, controller)
              }
            } else if (transformed) {
              processChunk(transformed, controller)
            }
          } catch (error) {
            logger.error(
              { error: error instanceof Error ? error.message : String(error) },
              'Stream flush transform error'
            )
          }
        }
      }

      streamContext.duration = Date.now() - startTime
      const sanitize = (s: string) =>
        s
          .replace(/[\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      const ri = streamContext.requestInfo || {
        model: 'unknown',
        provider: 'unknown',
        endpoint: '',
        toolsCount: 0,
        bodyLength: 0,
      }
      const logMsg = `[Streaming] ${streamContext.reqId} | ${ri.model} (${ri.provider}) | Tools:${ri.toolsCount} | ReqLen:${ri.bodyLength} | ${streamContext.duration}ms | Chunks:${streamContext.chunkCount} | Bytes:${streamContext.totalBytes}${streamContext.error ? ` | Error: ${sanitize(streamContext.error)}` : ''} | Text: "${sanitize(streamContext.accumulatedText)}" | Thinking: "${sanitize(streamContext.accumulatedThinking)}"`
      logger.info(logMsg)
    },
  })
}
