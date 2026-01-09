import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'stream-metrics' })

export interface StreamMetrics {
  reqId: string
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
  accumulatedSignatures: string[]
}

export function createStreamMetrics(reqId: string): StreamMetrics {
  return {
    reqId,
    chunkCount: 0,
    totalBytes: 0,
    duration: 0,
    fullResponse: '',
    accumulatedText: '',
    accumulatedThinking: '',
    accumulatedSignatures: [],
  }
}

function sanitize(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function logStreamMetrics(metrics: StreamMetrics): void {
  const ri = metrics.requestInfo || {
    model: 'unknown',
    provider: 'unknown',
    endpoint: '',
    toolsCount: 0,
    bodyLength: 0,
  }

  let logMsg = `[Streaming] ${metrics.reqId} | ${ri.model} (${ri.provider}) | Tools:${ri.toolsCount} | ReqLen:${ri.bodyLength} | ${metrics.duration}ms | Chunks:${metrics.chunkCount} | Bytes:${metrics.totalBytes}${metrics.error ? ` | Error: ${sanitize(metrics.error)}` : ''} | Text: "${sanitize(metrics.accumulatedText)}" | Thinking: "${sanitize(metrics.accumulatedThinking)}"`

  if (!metrics.accumulatedText && !metrics.accumulatedThinking) {
    logMsg += ` | Raw: "${sanitize(metrics.fullResponse.slice(0, 1000))}"`
  }

  logger.info(logMsg)
}

export function handleEmptyResponse(
  metrics: StreamMetrics,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (metrics.chunkCount === 0 && !metrics.error) {
    // 디버깅: 실제 받은 응답 내용 로깅
    logger.warn(
      {
        reqId: metrics.reqId,
        chunkCount: metrics.chunkCount,
        totalBytes: metrics.totalBytes,
        fullResponseLength: metrics.fullResponse.length,
        fullResponsePreview: metrics.fullResponse.slice(0, 500),
        accumulatedTextLength: metrics.accumulatedText.length,
        accumulatedThinkingLength: metrics.accumulatedThinking.length,
      },
      'Empty response detected - details'
    )

    const errorMsg =
      'Upstream model returned empty response (0 tokens). This may be due to safety filters or internal model refusal.'
    metrics.error = errorMsg
    const errorEvent = `event: error\ndata: {"type":"error","error":{"type":"upstream_error","message":"${errorMsg}"}}\n\n`
    controller.enqueue(encoder.encode(errorEvent))
  }
}
