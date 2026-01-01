/**
 * Opencode Zen Provider
 *
 * Hybrid provider that delegates to Anthropic or OpenAI logic based on model name.
 * - Claude models -> Anthropic format (v1/messages)
 * - GLM/Other models -> OpenAI format (v1/chat/completions)
 */

import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import { AnthropicProvider } from '../anthropic'
import type { ProviderConfig, ProviderName } from '../base'
import { BaseProvider } from '../base'
import { OpenAIProvider } from '../openai'

export class OpencodeZenProvider extends BaseProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  private anthropic: AnthropicProvider
  private openai: OpenAIProvider

  constructor(name: ProviderName = 'opencode-zen') {
    super()
    this.name = name
    this.config = {
      name,
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      defaultStreamParser: 'sse-line-delimited',
    }
    this.anthropic = new AnthropicProvider()
    this.openai = new OpenAIProvider()
  }

  private getDelegate(model?: string) {
    if (model?.includes('claude')) {
      return this.anthropic
    }
    return this.openai
  }

  parse(request: unknown): UnifiedRequest {
    // We can try to guess format or default to one.
    // However, parse is usually called on incoming request to llmux.
    // If opencode-zen is used as a SOURCE, we need to know format.
    // Typically `detectFormat` middleware handles detection.
    // But if we are explicitly parsing, we might check properties.
    if ((request as { messages?: unknown }).messages && (request as { system?: unknown }).system) {
      // Anthropic style has top-level system usually
      return this.anthropic.parse(request)
    }
    return this.openai.parse(request)
  }

  transform(request: UnifiedRequest): unknown {
    const model = request.metadata?.model as string | undefined
    return this.getDelegate(model).transform(request)
  }

  parseResponse(response: unknown): UnifiedResponse {
    // Detect response format
    if ((response as { type?: unknown }).type === 'message') {
      return this.anthropic.parseResponse(response)
    }
    return this.openai.parseResponse(response)
  }

  transformResponse(response: UnifiedResponse): unknown {
    // This is for sending response BACK.
    // Usually we use the format requested by client.
    // But this method converts Unified -> Provider Format.
    // We should probably rely on what the client expects?
    // Actually this method is rarely used directly in streaming proxy flow
    // (streaming flow transforms chunks).
    // Let's default to OpenAI as it's more generic, or Anthropic?
    // Let's assume generic structure.
    return this.openai.transformResponse(response)
  }

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    if (chunk.startsWith('event:') || chunk.includes('"type":"content_block')) {
      return this.anthropic.parseStreamChunk(chunk)
    }
    return this.openai.parseStreamChunk(chunk)
  }

  transformStreamChunk(chunk: StreamChunk): string | string[] {
    // This transforms Unified Chunk -> Provider Format.
    // This is used when llmux acts as a server sending to a client.
    // The format depends on what the CLIENT connected as (Anthropic vs OpenAI).
    // However, StreamingHandler usually uses the Target Provider's transform logic
    // to match the *Target* format? NO.
    // StreamingHandler uses `transformStreamChunk` of the *Source* format context?
    // Actually `streaming.ts` uses `transformStreamChunk` of the TARGET provider?
    // Wait. `streaming.ts` logic:
    // It calls `targetProvider.transform(unifiedRequest)` to send to Upstream.
    // Then it receives Upstream Stream.
    // It calls `targetProvider.parseStreamChunk(chunk)` to get Unified Chunk.
    // Then it calls `chunk.replace...` or whatever to convert to Client format?
    // NO. `streaming.ts` uses `transformStreamChunk` from `anthropic/streaming`
    // ONLY if the CLIENT expects Anthropic?

    // Correction: `streaming.ts` line 140 or so.
    // It determines `sourceFormat`.
    // It initializes `streamTransform` based on `sourceFormat`.
    // The `streamTransform` uses `anthropic.transformStreamChunk` if source is anthropic.

    // So THIS class's `transformStreamChunk` is only used if
    // `OpencodeZenProvider` is used as the *Source* (Client Side) protocol?
    // i.e. Client <--OpencodeZenProvider-- Server.
    // Since `opencode-zen` is usually an Upstream, this might be less critical.
    // But if we map `opencode-zen` to `anthropic` or `openai` protocols,
    // we should just implement it.

    // Since we don't know the preferred output format here (it depends on client),
    // and this Provider is mostly for Upstream, we can implement both or throw?
    // Let's default to OpenAI format as it's the default "delegate".
    return this.openai.transformStreamChunk(chunk)
  }
}
