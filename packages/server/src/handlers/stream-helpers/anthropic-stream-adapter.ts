import { createLogger } from '@llmux/core'

const logger = createLogger({ service: 'anthropic-stream-adapter' })

export type BlockType = 'thinking' | 'text' | 'tool_use' | 'stop' | null

export interface AnthropicStreamState {
  currentBlockType: BlockType
  currentBlockIndex: number
  messageStartSent: boolean
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    currentBlockType: null,
    currentBlockIndex: 0,
    messageStartSent: false,
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
      '[anthropic-stream-adapter] CRITICAL: Attempted to start tool_use block implicitly without ID/Name'
    )
    return null
  }
  return null
}

export function createBlockStopEvent(index: number): string {
  return `event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`
}

export function createMessageStartEvent(model: string): string {
  const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
  return `event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","content":[],"model":"${model}","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`
}

export function isEmptyTextBlock(chunk: string): boolean {
  const hasTextField = /"text"\s*:\s*/.test(chunk)
  if (!hasTextField) return false

  const textMatches = chunk.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)

  if (textMatches) {
    return textMatches.every((m) => /"text"\s*:\s*""/.test(m))
  }

  return false
}

export function patchStopReasonForToolUse(chunk: string): string {
  return chunk.replace(/"stop_reason":"end_turn"/g, '"stop_reason":"tool_use"')
}

export interface AnthropicProcessResult {
  stopProcessing: boolean
  finalChunk?: string
}

export function processAnthropicEvent(
  chunkStr: string,
  state: AnthropicStreamState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  options: { originalModel?: string; isFlush?: boolean } = {}
): AnthropicProcessResult {
  const { originalModel, isFlush } = options
  const chunkBlockType = detectBlockType(chunkStr)
  const isBlockStart = chunkStr.includes('"type":"content_block_start"')
  const isMessageStart = chunkStr.includes('"type":"message_start"')

  if (!isFlush && originalModel) {
    if (!state.messageStartSent && !isMessageStart) {
      if (chunkBlockType || isBlockStart) {
        controller.enqueue(encoder.encode(createMessageStartEvent(originalModel)))
        state.messageStartSent = true
      }
    }
    if (isMessageStart) {
      state.messageStartSent = true
    }
  }

  if (chunkBlockType === 'stop') {
    let finalChunk = chunkStr
    if (state.currentBlockType !== null) {
      if (state.currentBlockType === 'tool_use') {
        finalChunk = patchStopReasonForToolUse(finalChunk)
      }
      controller.enqueue(encoder.encode(createBlockStopEvent(state.currentBlockIndex)))
      state.currentBlockType = null
      state.currentBlockIndex++
    }
    return { stopProcessing: true, finalChunk }
  }

  if (isBlockStart) {
    if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return { stopProcessing: true }
    if (state.currentBlockType !== null) {
      controller.enqueue(encoder.encode(createBlockStopEvent(state.currentBlockIndex)))
      state.currentBlockIndex++
    }
    if (chunkBlockType) state.currentBlockType = chunkBlockType
  } else if (chunkBlockType && chunkBlockType !== state.currentBlockType) {
    if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return { stopProcessing: true }
    if (state.currentBlockType !== null) {
      controller.enqueue(encoder.encode(createBlockStopEvent(state.currentBlockIndex)))
      state.currentBlockIndex++
    }
    const startEvent = createBlockStartEvent(chunkBlockType, state.currentBlockIndex)
    if (startEvent) controller.enqueue(encoder.encode(startEvent))
    state.currentBlockType = chunkBlockType
  } else if (state.currentBlockType === null && chunkBlockType) {
    if (chunkBlockType === 'text' && isEmptyTextBlock(chunkStr)) return { stopProcessing: true }
    const startEvent = createBlockStartEvent(chunkBlockType, state.currentBlockIndex)
    if (startEvent) controller.enqueue(encoder.encode(startEvent))
    state.currentBlockType = chunkBlockType
  }

  return { stopProcessing: false }
}
