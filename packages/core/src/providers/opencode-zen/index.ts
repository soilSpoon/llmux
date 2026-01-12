/**
 * Opencode Zen Provider
 *
 * Hybrid provider that delegates to Anthropic or OpenAI logic based on model name.
 * - Claude models -> Anthropic format (v1/messages)
 * - GLM/Other models -> OpenAI format (v1/chat/completions)
 */

import type { FormatId } from '../../formats/base'
import { getFormat } from '../../formats/registry'
import type { StreamChunk, UnifiedRequest, UnifiedResponse } from '../../types/unified'
import type { ProviderConfig, ProviderName } from '../base'
import { BaseProvider } from '../base'

export class OpencodeZenProvider extends BaseProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  constructor(name: ProviderName = 'opencode-zen') {
    super()
    this.name = name
    this.config = {
      name,
      supportsStreaming: true,
      supportsThinking: true,
      supportsTools: true,
      authType: 'apiKey',
    }
  }

  isSupportedRequest(_request: unknown): boolean {
    // Opencode Zen can handle both formats by delegation,
    // but for detection purposes we defer to canonical providers
    // to avoid ambiguity in detectFormat.
    return false
  }

  parse(request: unknown): UnifiedRequest {
    // We can try to guess format or default to one.
    // However, parse is usually called on incoming request to llmux.
    // If opencode-zen is used as a SOURCE, we need to know format.
    // Typically `detectFormat` middleware handles detection.
    // But if we are explicitly parsing, we might check properties.
    if ((request as { messages?: unknown }).messages && (request as { system?: unknown }).system) {
      // Anthropic style has top-level system usually
      return getFormat('anthropic-messages').parseRequest(request)
    }
    return getFormat('openai-chat').parseRequest(request)
  }

  transform(request: UnifiedRequest, model: string): unknown {
    const formatId = this.getFormatForModel(model)
    const wireRequest = getFormat(formatId).buildWireRequest(request, {
      provider: this.name,
      model,
    }) as Record<string, unknown>

    // Refinement: Apply model-specific options based on Opencode Zen logic
    // Reference: opencode/packages/opencode/src/provider/transform.ts

    // 1. Thinking / Reasoning Support
    if (model.includes('kimi-k2-thinking') || model.includes('glm-4.6')) {
      wireRequest.chat_template_args = {
        ...(wireRequest.chat_template_args as Record<string, unknown>),
        enable_thinking: true,
      }
    }

    // 2. GPT-5 Specific Zen Options
    if (model.includes('gpt-5') && !model.includes('gpt-5-chat')) {
      // reasoning.encrypted_content is requested via 'include' array in Zen
      if (!model.includes('codex') && !model.includes('gpt-5-pro')) {
        wireRequest.reasoningEffort = wireRequest.reasoningEffort || 'medium'
      }

      // Zen specifically adds encrypted_content for its own provider
      wireRequest.include = Array.isArray(wireRequest.include)
        ? [...wireRequest.include, 'reasoning.encrypted_content']
        : ['reasoning.encrypted_content']

      wireRequest.reasoningSummary = 'auto'

      // Prompt caching session control
      if (request.metadata?.sessionId) {
        wireRequest.promptCacheKey = request.metadata.sessionId
      }
    }

    // 3. Gemini Thinking Config
    if (model.includes('gemini-3')) {
      wireRequest.thinkingConfig = {
        ...(wireRequest.thinkingConfig as Record<string, unknown>),
        includeThoughts: true,
        thinkingLevel: 'high',
      }
    }

    return wireRequest
  }

  // Extended transform to support model passing if caller supports it
  transformWithModel(request: UnifiedRequest, model: string): unknown {
    return this.transform(request, model)
  }

  parseResponse(response: Record<string, unknown>, model?: string): UnifiedResponse {
    // If model is provided, use its format
    if (model) {
      const formatId = this.getFormatForModel(model)
      return getFormat(formatId).parseResponse(response)
    }

    // Anthropic responses have type: "message"
    if (response.type === 'message' && Array.isArray(response.content)) {
      return getFormat('anthropic-messages').parseResponse(response)
    }

    // OpenAI responses have choices array
    if (Array.isArray(response.choices)) {
      return getFormat('openai-chat').parseResponse(response)
    }

    // Fall back to OpenAI format as default
    return getFormat('openai-chat').parseResponse(response)
  }

  transformResponse(response: UnifiedResponse): unknown {
    // Default to OpenAI format as it's the most common
    return getFormat('openai-chat').buildWireResponse(response, {
      provider: this.name,
      model: response.model || 'unknown',
    })
  }

  parseStreamChunk(chunk: string): StreamChunk | StreamChunk[] | null {
    if (chunk.startsWith('event:') || chunk.includes('"type":"content_block')) {
      return getFormat('anthropic-messages').parseStreamChunk?.(chunk) || null
    }

    // Gemini chunks often have candidates array
    if (chunk.includes('"candidates":[')) {
      return getFormat('google-gemini').parseStreamChunk?.(chunk) || null
    }

    // Default to OpenAI
    return getFormat('openai-chat').parseStreamChunk?.(chunk) || null
  }

  transformStreamChunk(chunk: StreamChunk): string | string[] {
    // Default to OpenAI format
    const result = getFormat('openai-chat').buildStreamChunk?.(chunk, {
      provider: this.name,
      model: chunk.model || 'unknown',
    })
    return result || ''
  }

  /**
   * Get the schema format ID for a specific model.
   * Routes Claude models to Anthropic format, all others to OpenAI format.
   */
  getFormatForModel(model: string): FormatId {
    // Reference: opencode models manifest (via models.dev)

    // Anthropic-compatible models (npm: "@ai-sdk/anthropic")
    if (model.includes('claude') || model.includes('minimax') || model.includes('alpha-gd4')) {
      return 'anthropic-messages'
    }

    // Google-compatible models (npm: "@ai-sdk/google")
    if (model.includes('gemini')) {
      return 'google-gemini'
    }

    // OpenAI Responses API models (typically GPT-5 family, Codex)
    if (model.includes('codex') || model.startsWith('gpt-5')) {
      return 'openai-responses'
    }

    // Default to OpenAI Chat for other models (npm: "@ai-sdk/openai" or "openai-compatible")
    // Includes: qwen, glm, grok, etc.
    return 'openai-chat'
  }

  /**
   * Detect the format from an incoming wire request.
   * Routes based on request structure.
   */
  getFormatForWireRequest(request: unknown): FormatId {
    const req = request as Record<string, unknown>

    // Anthropic style has top-level system usually
    if (req?.messages && req?.system) {
      return 'anthropic-messages'
    }

    // OpenAI style has messages with optional system inside
    if (req?.messages && Array.isArray(req.messages)) {
      return 'openai-chat'
    }

    throw new Error('Unsupported request format for OpenCode Zen provider')
  }
}
