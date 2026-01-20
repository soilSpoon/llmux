// Stream Context Creator needs to init accumulatedSignatures
import {
  AnthropicStreamingBuilder,
  createLogger,
  GeminiStreamingBuilder,
  getFormat,
  getProvider,
  OpenAIChatStreamingBuilder,
  OpenAIResponsesStreamingBuilder,
  type ProviderName,
  type SignatureCache,
  type StreamChunk,
  type StreamingPipeline,
} from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import { getRequestLogStore, type SignatureStore } from '../stores'
import type { ProviderStreamContext } from './providers/provider-strategy'
import { getProviderStrategy } from './providers/provider-strategy'
import { handleEmptyResponse, logStreamMetrics, type StreamMetrics } from './stream-helpers'
import { getParserType, splitSSEEvents } from './stream-processor'

const logger = createLogger({ service: 'stream-transformer' })

const MAX_STREAM_BUFFER_SIZE = 100 * 1024 * 1024 // 100MB
let loggedTruncationWarning = false

export interface StreamContext extends StreamMetrics {
  fromFormat: RequestFormat
  targetProvider: string
  targetModel: string
  originalModel: string
  finalModel: string
  lastThinkingSignature?: string
  lastThinkingText?: string
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
  const { startTime, sourceFormat, targetProvider, streamContext } = options

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

  interface StreamParser {
    parseStreamChunk?(chunk: string): StreamChunk | StreamChunk[] | null
  }

  interface StreamBuilder {
    build(chunk: StreamChunk): string[]
    flush(): string[]
  }

  let streamingPipeline: StreamingPipeline | undefined
  let streamingBuilder: StreamBuilder | undefined
  let formatParser: StreamParser | undefined

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
  } else if (sourceFormat === 'google-gemini') {
    streamingBuilder = new GeminiStreamingBuilder()
  } else if (sourceFormat === 'openai-responses') {
    streamingBuilder = new OpenAIResponsesStreamingBuilder(formatContext.model)
  }

  if (!streamingBuilder) {
    logger.warn(
      { sourceFormat, targetProvider },
      'No streaming builder available - falling back to pass-through'
    )
  }

  const parsingProvider = targetProvider
  let parserType = getParserType(parsingProvider)

  // Get provider strategy for handling provider-specific stream logic
  const providerStrategy = getProviderStrategy(targetProvider)

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true })
      streamContext.totalBytes += text.length
      if (streamContext.accumulatedUpstream.length < MAX_STREAM_BUFFER_SIZE) {
        streamContext.accumulatedUpstream += text
      }
      buffer += text

      parserType = getParserType(parsingProvider)
      const { events: rawEvents, remaining } = splitSSEEvents(buffer, parserType, text)

      buffer = remaining

      for (const rawEvent of rawEvents) {
        if (!rawEvent.trim()) continue

        // Provider Strategy: Handle raw stream event (e.g. signature extraction)
        if (providerStrategy?.handleStreamEvent) {
          providerStrategy.handleStreamEvent({
            event: rawEvent,
            context: options as unknown as ProviderStreamContext,
            state: {
              accumulatedSignatures: streamContext.accumulatedSignatures,
            },
          })
        }

        try {
          // New Architecture: Use Builder Pattern
          if (streamingBuilder && formatParser?.parseStreamChunk) {
            // 1. Parse: Gemini SSE -> Unified StreamChunk
            const parsed = formatParser.parseStreamChunk(rawEvent)

            // Debug: log parse result to main.log

            if (!parsed) {
              continue
            }

            // 누적 텍스트 업데이트 (파싱된 청크에서 텍스트 추출)
            const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
            const filteredChunks: StreamChunk[] = []

            for (const chunk of parsedChunks) {
              // Deduplicate thinking chunks
              if (chunk.type === 'thinking-delta' || chunk.type === 'thinking') {
                const thinking = chunk.delta?.thinking
                const signature = thinking?.signature
                const text = thinking?.text

                // If signature matches last one, check if text is duplicate
                // Gemini 3 sometimes sends exact duplicates of thinking blocks
                if (signature && signature === streamContext.lastThinkingSignature) {
                  if (text === streamContext.lastThinkingText) {
                    continue // Skip duplicate
                  }
                }

                streamContext.lastThinkingSignature = signature
                streamContext.lastThinkingText = text
                streamContext.accumulatedThinking += text || ''
              } else if (chunk.type === 'text-delta' || chunk.type === 'content') {
                streamContext.accumulatedText += chunk.delta?.text || ''
              }

              filteredChunks.push(chunk)
            }

            // 2. Build: Unified StreamChunk -> Anthropic SSE
            // Note: streamingBuilder.build returns string[]
            // Use type assertion or check type if needed. But we defined it above.
            for (const chunk of filteredChunks) {
              const builtEvents = streamingBuilder.build(chunk)

              for (const output of builtEvents) {
                if (!output.trim()) continue

                // No filter needed for Builder yet (Logic moved to Builder)

                // Stop buffering if limit reached, but continue streaming
                if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
                  streamContext.fullResponse += output
                } else if (!loggedTruncationWarning) {
                  logger.warn(
                    { reqId: options.reqId, bufferSize: streamContext.fullResponse.length },
                    'Stream buffer limit reached, truncation enabled'
                  )
                  loggedTruncationWarning = true
                }

                streamContext.chunkCount++
                controller.enqueue(encoder.encode(output))
              }
            }
          }
          // Legacy: Use StreamingPipeline
          else if (streamingPipeline) {
            // 1. Parse: Raw SSE → Unified StreamChunk
            const parsed = streamingPipeline.parse(rawEvent)

            if (!parsed) {
              continue
            }

            // 누적 텍스트 업데이트 (파싱된 청크에서 텍스트 추출)
            const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
            const filteredChunks = []

            for (const chunk of parsedChunks) {
              // Deduplicate thinking chunks
              if (
                (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
                chunk.delta?.thinking
              ) {
                const thinking = chunk.delta.thinking
                const signature = thinking.signature
                const text = thinking.text

                // If signature matches last one, check if text is duplicate
                if (signature && signature === streamContext.lastThinkingSignature) {
                  if (text === streamContext.lastThinkingText) {
                    continue // Skip duplicate
                  }
                }

                streamContext.lastThinkingSignature = signature
                streamContext.lastThinkingText = text
                streamContext.accumulatedThinking += text || ''
              } else if (
                (chunk.type === 'text-delta' || chunk.type === 'content') &&
                chunk.delta?.text
              ) {
                streamContext.accumulatedText += chunk.delta.text
              }

              filteredChunks.push(chunk)
            }

            // 2. Build: Unified StreamChunk → Target format SSE
            const built = streamingPipeline.build(filteredChunks)

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

              // Stop buffering if limit reached, but continue streaming
              if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
                streamContext.fullResponse += output
              } else if (!loggedTruncationWarning) {
                logger.warn(
                  { reqId: options.reqId, bufferSize: streamContext.fullResponse.length },
                  'Stream buffer limit reached, truncation enabled'
                )
                loggedTruncationWarning = true
              }

              streamContext.chunkCount++
              controller.enqueue(encoder.encode(output))
            }
          } else {
            // No builder/pipeline - Pass through with warning
            if (streamContext.chunkCount === 0) {
              logger.warn(
                { reqId: options.reqId, sourceFormat, targetProvider },
                'Streaming builder missing - falling back to raw pass-through'
              )
            }
            // Stop buffering if limit reached, but continue streaming
            if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
              streamContext.fullResponse += rawEvent
            } else if (!loggedTruncationWarning) {
              logger.warn(
                { reqId: options.reqId, bufferSize: streamContext.fullResponse.length },
                'Stream buffer limit reached, truncation enabled'
              )
              loggedTruncationWarning = true
            }

            streamContext.chunkCount++
            controller.enqueue(encoder.encode(rawEvent))
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
        parserType = getParserType(parsingProvider)
        const events =
          parserType === 'sse-line-delimited'
            ? buffer.split('\n').filter((e) => e.trim())
            : buffer.split('\n\n').filter((e) => e.trim())

        for (const event of events) {
          if (!event.trim()) continue

          // Provider Strategy: Handle raw stream event in flush
          if (providerStrategy?.handleStreamEvent) {
            providerStrategy.handleStreamEvent({
              event,
              context: options as unknown as ProviderStreamContext,
              state: {
                accumulatedSignatures: streamContext.accumulatedSignatures,
              },
            })
          }

          try {
            if (streamingBuilder && formatParser?.parseStreamChunk) {
              const parsed = formatParser.parseStreamChunk(event)
              if (!parsed) continue

              const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
              for (const chunk of parsedChunks) {
                if (chunk.type === 'text-delta' || chunk.type === 'content') {
                  if (streamContext.accumulatedText.length < MAX_STREAM_BUFFER_SIZE) {
                    streamContext.accumulatedText += chunk.delta?.text || ''
                  }
                } else if (chunk.type === 'thinking-delta' || chunk.type === 'thinking') {
                  const thinking = chunk.delta?.thinking
                  const signature = thinking?.signature
                  const text = thinking?.text

                  if (signature && signature === streamContext.lastThinkingSignature) {
                    if (text === streamContext.lastThinkingText) {
                      continue // Skip duplicate
                    }
                  }

                  streamContext.lastThinkingSignature = signature
                  streamContext.lastThinkingText = text
                  streamContext.accumulatedThinking += text
                }

                const builtEvents = streamingBuilder.build(chunk)
                for (const output of builtEvents) {
                  if (!output.trim()) continue
                  if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
                    streamContext.fullResponse += output
                  }
                  streamContext.chunkCount++
                  controller.enqueue(encoder.encode(output))
                }
              }
            } else if (streamingPipeline) {
              const parsed = streamingPipeline.parse(event)

              if (!parsed) {
                continue
              }

              const parsedChunks = Array.isArray(parsed) ? parsed : [parsed]
              const filteredChunks: StreamChunk[] = []

              for (const chunk of parsedChunks) {
                if (chunk.type === 'text-delta' || chunk.type === 'content') {
                  if (streamContext.accumulatedText.length < MAX_STREAM_BUFFER_SIZE) {
                    streamContext.accumulatedText += chunk.delta?.text || ''
                  }
                } else if (chunk.type === 'thinking-delta' || chunk.type === 'thinking') {
                  const thinking = chunk.delta?.thinking
                  const signature = thinking?.signature
                  const text = thinking?.text

                  if (signature && signature === streamContext.lastThinkingSignature) {
                    if (text === streamContext.lastThinkingText) {
                      continue // Skip duplicate
                    }
                  }

                  streamContext.lastThinkingSignature = signature
                  streamContext.lastThinkingText = text
                  streamContext.accumulatedThinking += text
                }

                filteredChunks.push(chunk)
              }

              const built = streamingPipeline.build(filteredChunks)

              if (!built) {
                continue
              }

              const outputs = Array.isArray(built) ? built : [built]
              for (const output of outputs) {
                if (!output.trim()) continue

                if (!streamingPipeline.filter(output)) {
                  continue
                }

                if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
                  streamContext.fullResponse += output
                }
                streamContext.chunkCount++
                controller.enqueue(encoder.encode(output))
              }
            } else {
              // Pass through in flush
              if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
                streamContext.fullResponse += event
              }
              streamContext.chunkCount++
              controller.enqueue(encoder.encode(event))
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

          if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
            streamContext.fullResponse += finalStr
          }
          streamContext.chunkCount += finalOutputs.length
          controller.enqueue(encoder.encode(finalStr))
        } else {
        }
      } else if (streamingPipeline) {
        const final = streamingPipeline.flush()
        if (final) {
          const finalOutputs = Array.isArray(final) ? final : [final]

          const finalStr = typeof final === 'string' ? final : finalOutputs.join('')
          if (streamContext.fullResponse.length < MAX_STREAM_BUFFER_SIZE) {
            streamContext.fullResponse += finalStr
          }
          streamContext.chunkCount += finalOutputs.length
          controller.enqueue(encoder.encode(finalStr))
        } else {
        }
      }

      streamContext.duration = Date.now() - startTime

      // Provider Strategy: Handle stream completion (e.g. caching thinking)
      if (providerStrategy?.onStreamComplete) {
        providerStrategy.onStreamComplete({
          context: options as unknown as ProviderStreamContext,
          state: {
            accumulatedThinking: streamContext.accumulatedThinking,
            accumulatedSignatures: streamContext.accumulatedSignatures,
            finalModel: streamContext.finalModel,
            targetModel: streamContext.targetModel,
          },
          reqId: options.reqId,
        })
      }

      handleEmptyResponse(streamContext, controller, encoder)
      logStreamMetrics(streamContext)

      // Log to SQLite
      try {
        const logStore = getRequestLogStore()
        logStore.logResponse({
          requestId: options.reqId,
          preTransformResponse: { _raw: streamContext.accumulatedUpstream },
          postTransformResponse: { _raw: streamContext.fullResponse },
          statusCode: 200,
          durationMs: streamContext.duration,
        })
      } catch (err) {
        logger.warn({ error: String(err) }, 'Failed to log streaming response to SQLite')
      }
    },
  })
}
