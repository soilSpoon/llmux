import { z } from 'zod'
import type { JsonObject } from '../../../types/json-schema'
import type { StreamChunk } from '../../../types/unified'
import { ToolNameCodec } from '../../../util/tool-name-codec'
import { mapStopReason } from '../shared/response'

const GeminiPartSchema = z.object({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
  thought_signature: z.string().optional(),

  functionCall: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      args: z.record(z.string(), z.any()).or(z.string()).optional(),
    })
    .optional(),
})

const GeminiUsageMetadataSchema = z.object({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  totalTokenCount: z.number().optional(),
})

const GeminiCandidateSchema = z.object({
  content: z
    .object({
      parts: z.array(GeminiPartSchema).optional(),
      role: z.string().optional(),
    })
    .optional(),
  finishReason: z.string().optional(),
  index: z.number().optional(),
})

const GeminiResponseSchema = z.object({
  candidates: z.array(GeminiCandidateSchema).optional(),
  usageMetadata: GeminiUsageMetadataSchema.optional(),
  responseId: z.string().optional(),
  promptFeedback: z.record(z.string(), z.unknown()).optional(),
})

const AntigravityWrapperSchema = z.object({
  response: GeminiResponseSchema,
})

export const StreamEventSchema = AntigravityWrapperSchema.or(GeminiResponseSchema)

export type GeminiStreamEvent = z.infer<typeof StreamEventSchema>

export function parseGeminiStreamChunk(chunk: unknown): StreamChunk[] | null {
  if (!chunk || typeof chunk !== 'object') return null

  const validation = StreamEventSchema.safeParse(chunk)

  if (!validation.success) {
    return null
  }

  const data = validation.data

  const response = 'response' in data ? data.response : data

  if (!response.candidates?.[0]) {
    if (response.usageMetadata) {
      return [
        {
          type: 'usage',
          usage: {
            inputTokens: response.usageMetadata.promptTokenCount || 0,
            outputTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          },
        },
      ]
    }
    return null
  }

  const candidate = response.candidates[0]
  const chunks: StreamChunk[] = []

  if (response.usageMetadata) {
    chunks.push({
      type: 'usage',
      usage: {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0,
      },
    })
  }

  if (candidate.content?.parts) {
    for (const part of candidate.content.parts) {
      const isThinking = part.thought === true
      const signature = part.thoughtSignature || part.thought_signature

      if (isThinking && part.text) {
        chunks.push({
          type: 'thinking-delta',
          delta: {
            thinking: { text: part.text, signature },
          },
        })
      } else if (part.text) {
        if (signature) {
          chunks.push({
            type: 'thinking-delta',
            delta: {
              thinking: { text: '', signature },
            },
          })
        }

        chunks.push({
          type: 'text-delta',
          delta: { text: part.text },
        })
      } else if (part.functionCall) {
        const codec = new ToolNameCodec()
        const toolId = part.functionCall.id || `call_${Math.random().toString(36).slice(2)}`

        chunks.push({
          type: 'tool_call',
          delta: {
            type: 'tool_call',
            toolCall: {
              id: toolId,
              name: codec.decode(part.functionCall.name),
              arguments: (part.functionCall.args || {}) as JsonObject | string,
            },
          },
        })
      }
    }
  }

  if (candidate.finishReason) {
    chunks.push({
      type: 'finish',
      finishReason: {
        unified: mapStopReason(candidate.finishReason),
        raw: candidate.finishReason,
      },
    })
  }

  return chunks.length > 0 ? chunks : null
}
