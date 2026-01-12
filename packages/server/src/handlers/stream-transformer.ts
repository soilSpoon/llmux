// Stream Context Creator needs to init accumulatedSignatures
import {
  AnthropicStreamingBuilder,
  createLogger,
  createTextHash,
  getFormat,
  getModelFamily,
  getProvider,
  OpenAIChatStreamingBuilder,
  type ProviderName,
  type SignatureCache,
  type StreamingPipeline,
} from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import type { SignatureStore } from '../stores'
import {
  handleEmptyResponse,
  logStreamMetrics,
  recordSignaturesFromSSE,
  type StreamMetrics,
} from './stream-helpers'
import { createStreamDebugLogger, shouldEnableDebugLogging } from './stream-helpers/stream-debug'
import { getParserType, splitSSEEvents } from './stream-processor'

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
    signatureCache: SignatureCache
    sessionId: string
    onSave?: (count: number) => void
  }
}

export function createStreamTransformer(options: StreamTransformerOptions) {
  const { startTime, sourceFormat, targetProvider, streamContext, signatureContext } = options

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''

  // 주의: sourceFormat은 요청 포맷이지만, 업스트림은 다른 포맷으로 응답할 수 있음
  // 예: Anthropic 요청 -> Antigravity/Gemini 응답
  // 실제 응답 포맷은 targetProvider에 따라 달라짐

  // Antigravity provider는 Gemini 포맷으로 응답하므로 google-gemini 파이프라인 사용해야 함
  // sourceFormat과 관계없이 targetProvider 기반으로 파이프라인 선택
  // Hub-and-Spoke Architecture:
  // 1. Parser (Target Provider Format) -> Unified StreamChunk
  // 2. Builder (Source Format)          -> Unified StreamChunk -> Target SSE

  let streamingPipeline: StreamingPipeline | undefined
  let streamingBuilder: { build(chunk: unknown): string[]; flush(): string[] } | undefined
  let formatParser: { parseStreamChunk?(chunk: string): unknown } | undefined

  const formatContext = {
    provider: targetProvider as ProviderName,
    model:
      streamContext.originalModel && streamContext.originalModel !== 'unknown'
        ? streamContext.originalModel
        : streamContext.finalModel,
  }

  // 1. Determine PARSER from Target Provider
  try {
    const targetProviderConfig = getProvider(targetProvider)
    const targetFormatId = targetProviderConfig.getFormatForModel?.(
      streamContext.finalModel || streamContext.targetModel
    )
    if (targetFormatId) {
      formatParser = getFormat(targetFormatId)
    }
  } catch (error) {
    logger.warn(
      { error: String(error), targetProvider },
      'Failed to resolve target format parser - falling back'
    )
  }

  // 2. Determine BUILDER from Source Format
  if (sourceFormat === 'anthropic-messages') {
    streamingBuilder = new AnthropicStreamingBuilder(formatContext.model)
  } else if (sourceFormat === 'openai-chat') {
    streamingBuilder = new OpenAIChatStreamingBuilder()
  }

  // 3. LEGACY: If no builder is available for sourceFormat, use the legacy StreamingPipeline
  if (!streamingBuilder) {
    streamingPipeline = getFormat(sourceFormat).getStreamingPipeline?.(formatContext)
  }

  if (!streamingPipeline && !streamingBuilder) {
    logger.warn(
      { sourceFormat, targetProvider },
      'No streaming components available - falling back to pass-through'
    )
  }

  const parsingProvider = targetProvider === 'gemini-cli' ? 'antigravity' : targetProvider
  let parserType = getParserType(parsingProvider, formatContext.model)

  const debugLogger = createStreamDebugLogger({
    reqId: options.reqId,
    targetProvider: targetProvider,
    sourceFormat: sourceFormat,
    enabled: shouldEnableDebugLogging(targetProvider),
  })

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true })
      streamContext.totalBytes += text.length
      buffer += text

      // 디버깅: 업스트림에서 받은 청크 기록

      debugLogger.logChunk(text)

      parserType = getParserType(parsingProvider, formatContext.model)
      const { events: rawEvents, remaining } = splitSSEEvents(buffer, parserType, text)

      buffer = remaining

      for (const rawEvent of rawEvents) {
        if (!rawEvent.trim()) continue

        debugLogger.logEvent(rawEvent)

        if (signatureContext) {
          // Record signatures to legacy store
          // AND capture them for thinking cache
          // We need custom logic here since recordSignaturesFromSSE is void
          // But looking at imports, we can import extractSignaturesFromSSE
          // Let's rely on recordSignaturesFromSSE for legacy, but we need to extract for ourselves?
          // Actually, let's update recordSignaturesFromSSE in stream-helpers or just copy extraction here.
          // Importing extractSignaturesFromSSE from valid location:
          const { extractSignaturesFromSSE } = require('./signature-response')
          const signatures = extractSignaturesFromSSE(`data: ${rawEvent}`)

          if (signatures.length > 0) {
            streamContext.accumulatedSignatures.push(...signatures)
            // Also call legacy recorder
            recordSignaturesFromSSE(rawEvent, signatureContext)
          }
        }

        try {
          // New Architecture: Use Builder Pattern
          if (streamingBuilder && formatParser?.parseStreamChunk) {
            // 1. Parse: Gemini SSE -> Unified StreamChunk
            const parsed = formatParser.parseStreamChunk(rawEvent)

            debugLogger.logParseResult(rawEvent, parsed)

            // Debug: log parse result to main.log

            if (!parsed) {
              continue
            }

            // 누적 텍스트 업데이트 (파싱된 청크에서 텍스트 추출)
            const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
            for (const chunk of parsedChunks) {
              if ((chunk.type === 'text-delta' || chunk.type === 'content') && chunk.delta?.text) {
                streamContext.accumulatedText += chunk.delta.text
              } else if (
                (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
                chunk.delta?.thinking?.text
              ) {
                streamContext.accumulatedThinking += chunk.delta.thinking.text
              }
            }

            // 2. Build: Unified StreamChunk -> Anthropic SSE
            // Note: streamingBuilder.build returns string[]
            // Use type assertion or check type if needed. But we defined it above.
            for (const chunk of parsedChunks) {
              const builtEvents = streamingBuilder.build(chunk)

              for (const output of builtEvents) {
                if (!output.trim()) continue

                // No filter needed for Builder yet (Logic moved to Builder)

                streamContext.fullResponse += output
                streamContext.chunkCount++
                controller.enqueue(encoder.encode(output))
              }
            }
          }
          // Legacy: Use StreamingPipeline
          else if (streamingPipeline) {
            // 1. Parse: Raw SSE → Unified StreamChunk
            const parsed = streamingPipeline.parse(rawEvent)

            debugLogger.logParseResult(rawEvent, parsed)

            if (!parsed) {
              continue
            }

            // 누적 텍스트 업데이트 (파싱된 청크에서 텍스트 추출)
            const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
            for (const chunk of parsedChunks) {
              if ((chunk.type === 'text-delta' || chunk.type === 'content') && chunk.delta?.text) {
                streamContext.accumulatedText += chunk.delta.text
              } else if (
                (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
                chunk.delta?.thinking?.text
              ) {
                streamContext.accumulatedThinking += chunk.delta.thinking.text
              }
            }

            // 2. Build: Unified StreamChunk → Target format SSE
            const built = streamingPipeline.build(parsedChunks)

            if (!built) {
              continue
            }

            // 3. Filter: Decide which outputs to include
            const outputs = Array.isArray(built) ? built : [built]
            for (const output of outputs) {
              if (!output.trim()) continue

              // Filter decides if we include this output
              if (!streamingPipeline.filter(output)) {
                continue
              }

              streamContext.fullResponse += output
              streamContext.chunkCount++
              controller.enqueue(encoder.encode(output))
            }
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
      logger.info(
        {
          reqId: options.reqId,
          bufferLength: buffer.length,
          bufferContent: buffer.slice(0, 200),
          chunkCountBefore: streamContext.chunkCount,
          totalBytesBefore: streamContext.totalBytes,
        },
        '[stream-flush] Starting flush phase'
      )

      if (buffer.trim()) {
        parserType = getParserType(parsingProvider, formatContext.model)
        const events =
          parserType === 'sse-line-delimited'
            ? buffer.split('\n').filter((e) => e.trim())
            : buffer.split('\n\n').filter((e) => e.trim())

        logger.info(
          {
            reqId: options.reqId,
            eventCount: events.length,
            parserType,
          },
          '[stream-flush] Buffer events to process'
        )

        const { extractSignaturesFromSSE } = require('./signature-response')

        for (const event of events) {
          if (!event.trim()) continue

          // Record signatures in flush phase as well
          if (signatureContext) {
            const signatures = extractSignaturesFromSSE(`data: ${event}`)
            if (signatures.length > 0) {
              streamContext.accumulatedSignatures.push(...signatures)
              recordSignaturesFromSSE(event, signatureContext)
            }
          }

          try {
            if (streamingBuilder && formatParser?.parseStreamChunk) {
              const parsed = formatParser.parseStreamChunk(event)
              if (!parsed) continue

              const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
              for (const chunk of parsedChunks) {
                if (
                  (chunk.type === 'text-delta' || chunk.type === 'content') &&
                  chunk.delta?.text
                ) {
                  streamContext.accumulatedText += chunk.delta.text
                } else if (
                  (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
                  chunk.delta?.thinking?.text
                ) {
                  streamContext.accumulatedThinking += chunk.delta.thinking.text
                }

                const builtEvents = streamingBuilder.build(chunk)
                for (const output of builtEvents) {
                  if (!output.trim()) continue
                  streamContext.fullResponse += output
                  streamContext.chunkCount++
                  controller.enqueue(encoder.encode(output))
                }
              }
            } else if (streamingPipeline) {
              const parsed = streamingPipeline.parse(event)

              if (!parsed) {
                continue
              }

              // 누적 텍스트 업데이트 (flush 단계에서도)
              const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
              for (const chunk of parsedChunks) {
                if (
                  (chunk.type === 'text-delta' || chunk.type === 'content') &&
                  chunk.delta?.text
                ) {
                  streamContext.accumulatedText += chunk.delta.text
                } else if (
                  (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
                  chunk.delta?.thinking?.text
                ) {
                  streamContext.accumulatedThinking += chunk.delta.thinking.text
                }
              }

              const built = streamingPipeline.build(parsedChunks)

              if (!built) {
                continue
              }

              const outputs = Array.isArray(built) ? built : [built]
              for (const output of outputs) {
                if (!output.trim()) continue

                if (!streamingPipeline.filter(output)) {
                  continue
                }

                streamContext.fullResponse += output
                streamContext.chunkCount++
                controller.enqueue(encoder.encode(output))
              }
            }
          } catch (error) {
            logger.error(
              { error: error instanceof Error ? error.message : String(error) },
              'Stream flush transform error'
            )
          }
        }
      }

      // Flush final state from pipeline/builder
      if (streamingBuilder) {
        const finalOutputs = streamingBuilder.flush()

        if (finalOutputs && finalOutputs.length > 0) {
          const finalStr = finalOutputs.join('')

          streamContext.fullResponse += finalStr
          streamContext.chunkCount += finalOutputs.length
          controller.enqueue(encoder.encode(finalStr))
        } else {
        }
      } else if (streamingPipeline) {
        const final = streamingPipeline.flush()
        if (final) {
          const finalOutputs = Array.isArray(final) ? final : [final]

          const finalStr = typeof final === 'string' ? final : finalOutputs.join('')
          streamContext.fullResponse += finalStr
          streamContext.chunkCount += finalOutputs.length
          controller.enqueue(encoder.encode(finalStr))
        } else {
        }
      }

      streamContext.duration = Date.now() - startTime
      logger.info(
        {
          reqId: options.reqId,
          chunkCountFinal: streamContext.chunkCount,
          totalBytesFinal: streamContext.totalBytes,
          durationMs: streamContext.duration,
          hasThinking: !!streamContext.accumulatedThinking,
          signatureCount: streamContext.accumulatedSignatures.length,
        },
        '[stream-flush] Flush complete'
      )

      // Antigravity: Store Thinking Text in Cache
      if (
        signatureContext?.signatureCache &&
        streamContext.accumulatedThinking &&
        streamContext.accumulatedSignatures.length > 0
      ) {
        const { signatureCache, sessionId } = signatureContext
        const thinkingText = streamContext.accumulatedThinking
        const model = streamContext.finalModel || streamContext.targetModel || 'unknown'

        // Use the last signature found (usually corresponds to the block)
        // Or store for ALL signatures found? Typically 1 thinking block = 1 signature.
        const signature =
          streamContext.accumulatedSignatures[streamContext.accumulatedSignatures.length - 1]
        const textHash = createTextHash(thinkingText)
        const family = getModelFamily(model) // We need this helper

        logger.debug(
          { reqId: options.reqId, model, textLength: thinkingText.length },
          'Caching complete thinking text'
        )

        if (signature) {
          try {
            signatureCache.store({ sessionId, model, textHash }, signature, family, thinkingText)
          } catch (err) {
            logger.warn({ error: String(err) }, 'Failed to cache thinking text')
          }
        }
      }

      handleEmptyResponse(streamContext, controller, encoder)
      logStreamMetrics(streamContext)
    },
  })
}
