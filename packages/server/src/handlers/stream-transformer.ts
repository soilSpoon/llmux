import { createLogger, type ProviderName } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import type { SignatureStore } from '../stores'
import {
  createAnthropicStreamState,
  handleEmptyResponse,
  logStreamMetrics,
  processAnthropicEvent,
  recordSignaturesFromSSE,
  type StreamMetrics,
} from './stream-helpers'
import { createStreamParser } from './stream-helpers/stream-parser'
import {
  extractContentFromChunk,
  getParserType,
  splitSSEEvents,
  updateChunkIndex,
} from './stream-processor'

const logger = createLogger({ service: 'stream-transformer' })

export interface StreamContext extends StreamMetrics {
  fromFormat: RequestFormat
  targetProvider: string
  targetModel: string
  originalModel: string
  finalModel: string
}

export interface StreamTransformerOptions {
  reqId: string
  startTime: number
  sourceFormat: RequestFormat
  targetProvider: ProviderName
  streamContext: StreamContext
  signatureContext?: {
    projectId: string
    provider: string
    endpoint: string
    account: string
    signatureStore: SignatureStore
    onSave?: (count: number) => void
  }
}

export function createStreamTransformer(options: StreamTransformerOptions) {
  const { startTime, sourceFormat, targetProvider, streamContext, signatureContext } = options

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''

  const anthropicState = createAnthropicStreamState()

  const parsingProvider = targetProvider === 'gemini-cli' ? 'antigravity' : targetProvider
  const streamParser = createStreamParser(
    parsingProvider as ProviderName,
    sourceFormat as ProviderName
  )
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

        if (signatureContext) {
          recordSignaturesFromSSE(rawEvent, signatureContext)
        }

        logger.trace(
          {
            rawEvent,
            currentBlockType: anthropicState.currentBlockType,
            currentBlockIndex: anthropicState.currentBlockIndex,
          },
          '[streaming] Processing raw SSE event'
        )

        const eventWithNewline = `${rawEvent}\n\n`
        try {
          // Unified Streaming Logic: Parse -> Unified Chunk -> Transform
          // This replaces the old transformStreamChunk direct call

          const transformedChunks: string[] = []

          // 1. Parse raw event to StreamChunk
          const chunks = streamParser.parse(eventWithNewline)

          if (chunks) {
            const chunkArray = Array.isArray(chunks) ? chunks : [chunks]

            // 2. Transform StreamChunk to target format string
            for (const chunk of chunkArray) {
              const result = streamParser.transform(chunk)
              if (Array.isArray(result)) {
                transformedChunks.push(...result)
              } else if (result) {
                transformedChunks.push(result)
              }
            }
          }

          // Fallback to legacy behavior if parser didn't return anything (or not implemented yet for some providers)
          // But since we implemented parseStreamChunk for OpenAI/Anthropic/Gemini, this should work.
          // However, transformStreamChunk in stream-processor.ts might handle edge cases.
          // Let's use the new flow primarily.

          // const transformed = transformStreamChunk(eventWithNewline, parsingProvider, sourceFormat)

          const processChunk = (
            chunkStr: string,
            ctrl: TransformStreamDefaultController<Uint8Array>
          ) => {
            if (!chunkStr.trim()) return

            if (sourceFormat === 'anthropic') {
              const result = processAnthropicEvent(chunkStr, anthropicState, ctrl, encoder, {
                originalModel: streamContext.originalModel,
              })

              if (result.finalChunk) {
                streamContext.fullResponse += result.finalChunk
                streamContext.chunkCount++
                ctrl.enqueue(encoder.encode(result.finalChunk))
              }

              if (result.stopProcessing) return
            }

            const updatedChunk = updateChunkIndex(chunkStr, anthropicState.currentBlockIndex)
            const content = extractContentFromChunk(chunkStr)
            if (content.text) streamContext.accumulatedText += content.text
            if (content.thinking) streamContext.accumulatedThinking += content.thinking

            streamContext.chunkCount++
            streamContext.fullResponse += updatedChunk
            ctrl.enqueue(encoder.encode(updatedChunk))

            if (sourceFormat === 'anthropic') {
              if (chunkStr.includes('"type":"content_block_stop"')) {
                anthropicState.currentBlockType = null
                anthropicState.currentBlockIndex++
              }
            }
          }

          if (transformedChunks.length > 0) {
            for (const t of transformedChunks) {
              if (t.trim()) processChunk(t, controller)
            }
          }
          /* 
          else if (transformed?.trim()) {
            processChunk(transformed, controller)
          } 
          */
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
        parserType = getParserType(parsingProvider)
        const events =
          parserType === 'sse-line-delimited'
            ? buffer.split('\n').filter((e) => e.trim())
            : buffer.split('\n\n').filter((e) => e.trim())

        for (const event of events) {
          const eventWithNewline = `${event}\n\n`
          try {
            // Unified Parsing for Flush
            const transformedChunks: string[] = []
            const chunks = streamParser.parse(eventWithNewline)
            if (chunks) {
              const chunkArray = Array.isArray(chunks) ? chunks : [chunks]
              for (const chunk of chunkArray) {
                const result = streamParser.transform(chunk)
                if (Array.isArray(result)) transformedChunks.push(...result)
                else if (result) transformedChunks.push(result)
              }
            }

            const processChunk = (
              chunkStr: string,
              ctrl: TransformStreamDefaultController<Uint8Array>
            ) => {
              if (!chunkStr.trim()) return

              if (sourceFormat === 'anthropic') {
                const result = processAnthropicEvent(chunkStr, anthropicState, ctrl, encoder, {
                  isFlush: true,
                })

                if (result.finalChunk) {
                  streamContext.chunkCount++
                  streamContext.fullResponse += result.finalChunk
                  ctrl.enqueue(encoder.encode(result.finalChunk))
                  return
                }

                if (result.stopProcessing) return
              }

              const updatedChunk = updateChunkIndex(chunkStr, anthropicState.currentBlockIndex)
              streamContext.chunkCount++
              streamContext.fullResponse += updatedChunk
              ctrl.enqueue(encoder.encode(updatedChunk))

              if (sourceFormat === 'anthropic') {
                if (chunkStr.includes('"type":"content_block_stop"')) {
                  anthropicState.currentBlockType = null
                  anthropicState.currentBlockIndex++
                }
              }
            }

            if (transformedChunks.length > 0) {
              for (const t of transformedChunks) processChunk(t, controller)
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
      handleEmptyResponse(streamContext, controller, encoder)
      logStreamMetrics(streamContext)

      if (sourceFormat === 'anthropic') {
        const doneSignal = 'data: [DONE]\n\n'
        streamContext.fullResponse += doneSignal
        controller.enqueue(encoder.encode(doneSignal))
      }
    },
  })
}
