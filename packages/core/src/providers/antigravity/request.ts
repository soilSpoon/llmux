import crypto from 'node:crypto'
import {
  buildWireRequest as buildGeminiRequest,
  parseRequest as parseGeminiRequest,
} from '../../formats/google-gemini/request'
import type { GeminiRequest } from '../../formats/google-gemini/types'
import { encodeAntigravityToolName } from '../../schema/reversible-tool-name'
import type { UnifiedRequest } from '../../types/unified'
import { ANTIGRAVITY_SYSTEM_INSTRUCTION, SKIP_THOUGHT_SIGNATURE } from './constants'
import {
  createInnerRequest,
  ensureToolConfig,
  extractMetadata,
  injectSystemInstruction,
  preprocessAntigravityRequest,
  preprocessTools,
} from './transform-utils'
import type { AntigravityRequest } from './types'

export function parse(request: AntigravityRequest): UnifiedRequest {
  const unified = parseGeminiRequest(request.request as GeminiRequest)

  // Extract metadata
  unified.metadata = {
    ...unified.metadata,
    project: request.project,
    model: request.model,
    userAgent: request.userAgent,
    requestId: request.requestId,
  }

  if (request.request.sessionId) {
    unified.metadata.sessionId = request.request.sessionId
  }

  // Handle system instruction concatenation if multiple parts
  const sysParts = request.request.systemInstruction?.parts
  if (sysParts && sysParts.length > 0) {
    if (sysParts.length > 1) {
      unified.system = sysParts.map((p) => p.text).join('\n')
    } else if (sysParts[0]?.text) {
      unified.system = sysParts[0].text
    }
  }

  // Handle thinking config parsing
  const genConfig = request.request.generationConfig
  if (genConfig?.thinkingConfig) {
    // Both are now camelCase in internal representation
    const thinking = genConfig.thinkingConfig

    unified.thinking = {
      enabled: true,
      budget: thinking.thinkingBudget,
      includeThoughts: thinking.includeThoughts,
    }
  }

  return unified
}

export function transform(request: UnifiedRequest, model: string): AntigravityRequest {
  const preprocessed = preprocessAntigravityRequest(request, model)
  const tools = preprocessTools(preprocessed.tools)

  const geminiRequest = buildGeminiRequest(
    { ...preprocessed, tools },
    {
      provider: 'antigravity',
      model,
    }
  )

  const sessionId = request.metadata?.sessionId || `session-${crypto.randomUUID()}`
  const innerRequest = createInnerRequest(geminiRequest, sessionId)

  injectSystemInstruction(innerRequest, ANTIGRAVITY_SYSTEM_INSTRUCTION, model)
  ensureToolConfig(innerRequest, model)

  // Post-process contents
  if (innerRequest.contents) {
    processContentsForThinking(innerRequest.contents, preprocessed.thinking?.enabled || false)
  }

  // Random project ID matching /^[a-z]+-[a-z]+-[0-9a-f]{5}$/
  // e.g. random-project-12345
  const project =
    request.metadata?.project || `random-project-${crypto.randomUUID().substring(0, 5)}`

  return {
    project,
    model,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: request.metadata?.requestId ?? `agent-${crypto.randomUUID()}`,
    request: innerRequest,
    metadata: extractMetadata(request.metadata),
    ...(request.metadata?.sessionId && { sessionId: request.metadata.sessionId }),
  }
}

function processContentsForThinking(
  contents: NonNullable<GeminiRequest['contents']>,
  thinkingEnabled: boolean
) {
  for (const content of contents) {
    if (!content.parts) continue

    let hasToolCall = false
    let hasThought = false

    for (const part of content.parts) {
      if (part.functionCall) {
        hasToolCall = true
        part.functionCall.name = encodeAntigravityToolName(part.functionCall.name)
      }
      if (part.functionResponse) {
        part.functionResponse.name = encodeAntigravityToolName(part.functionResponse.name)
      }
      if (part.thought) {
        hasThought = true
      }

      // Validate thoughtSignature
      if (part.thoughtSignature) {
        if (part.thoughtSignature.length < 30) {
          part.thoughtSignature = SKIP_THOUGHT_SIGNATURE
        }
      } else if (part.functionCall && thinkingEnabled) {
        // If thinking enabled and tool call exists, defaulting to skip sentinel if missing
        // This mimics the "B-option" test expectation
        part.thoughtSignature = SKIP_THOUGHT_SIGNATURE
      }
    }

    // Inject thinking block if needed
    // This invariant ensures downstream validators don't fail when a tool call happens without thinking
    if (content.role === 'model' && thinkingEnabled && hasToolCall && !hasThought) {
      content.parts.unshift({
        thought: true,
        text: 'Thinking Process...',
        thoughtSignature: SKIP_THOUGHT_SIGNATURE, // Mock signature or skip
      })
    }
  }
}
