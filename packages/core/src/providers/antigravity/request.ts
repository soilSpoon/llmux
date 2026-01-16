import crypto from 'node:crypto'
import {
  buildWireRequest as buildGeminiRequest,
  parseRequest as parseGeminiRequest,
} from '../../formats/google-gemini/request'
import type { GeminiRequest } from '../../formats/google-gemini/types'
import { encodeAntigravityToolName } from '../../schema/reversible-tool-name'
import type { UnifiedRequest } from '../../types/unified'
import { ANTIGRAVITY_SYSTEM_INSTRUCTION } from './constants'
import {
  createInnerRequest,
  ensureToolConfig,
  extractMetadata,
  injectSystemInstruction,
  isClaudeModel,
  isThinkingModel,
  normalizeGenerationConfig,
  preprocessTools,
} from './transform-utils'
import type { AntigravityRequest, ClaudeThinkingConfig, GeminiThinkingConfig } from './types'

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
  const tools = preprocessTools(request.tools)
  const geminiRequest = buildGeminiRequest(
    { ...request, tools },
    {
      provider: 'antigravity',
      model,
    }
  )

  const sessionId = request.metadata?.sessionId || `session-${crypto.randomUUID()}`
  const innerRequest = createInnerRequest(geminiRequest, sessionId)

  injectSystemInstruction(innerRequest, ANTIGRAVITY_SYSTEM_INSTRUCTION, model)
  ensureToolConfig(innerRequest, model)
  normalizeGenerationConfig(innerRequest, model)

  // Handle thinking config mapping
  let thinkingEnabled = false
  if (request.thinking) {
    thinkingEnabled = request.thinking.enabled
    // Ensure generationConfig exists
    if (!innerRequest.generationConfig) {
      innerRequest.generationConfig = {}
    }
    const genConfig = innerRequest.generationConfig

    // Claude thinking models use camelCase config format
    if (isClaudeModel(model) && isThinkingModel(model)) {
      // Min output tokens for Claude thinking
      if ((request.config?.maxTokens || 0) < 64000) {
        genConfig.maxOutputTokens = 64000
      }

      // Derive budget from level if not explicitly provided
      let budget = request.thinking.budget

      // Fallback: Map reasoning_effort (from OpenAI format) to thinking budget
      if (!budget && request.thinking.effort) {
        switch (request.thinking.effort) {
          case 'low':
            budget = 8192
            break
          case 'medium':
            budget = 16384
            break
          case 'high':
            budget = 32768
            break
        }
      }

      if (!budget && request.thinking.level) {
        switch (request.thinking.level) {
          case 'low':
            budget = 8192
            break
          case 'medium':
            budget = 16384
            break
          case 'high':
            budget = 32768
            break
        }
      }

      genConfig.thinkingConfig = {
        includeThoughts: request.thinking.includeThoughts,
        thinkingBudget: request.thinking.budget,
      } as ClaudeThinkingConfig
    } else if (model.toLowerCase().includes('gemini')) {
      // Map reasoning_effort to thinkingLevel for Gemini 3
      let level = request.thinking.level

      if (!level && request.thinking.effort) {
        // Direct mapping from reasoning_effort to thinkingLevel
        level = request.thinking.effort as 'low' | 'medium' | 'high'
      }

      genConfig.thinkingConfig = {
        includeThoughts: request.thinking.includeThoughts ?? request.thinking.enabled,
        thinkingBudget: request.thinking.budget,
        thinkingLevel: level,
      } as GeminiThinkingConfig
    }
  }

  // Post-process contents for:
  // 1. Tool name encoding (replace / with __)
  // 2. Thought signature validation / skip sentinel
  // 3. Inject thinking block if missing
  if (innerRequest.contents) {
    for (const content of innerRequest.contents) {
      // Encode tool names in functionResponse
      if (content.parts) {
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
              part.thoughtSignature = 'skip_thought_signature_validator'
            }
          } else if (part.functionCall && thinkingEnabled) {
            // If thinking enabled and tool call exists, defaulting to skip sentinel if missing
            // This mimics the "B-option" test expectation
            part.thoughtSignature = 'skip_thought_signature_validator'
          }
        }

        // Inject thinking block if needed
        if (content.role === 'model' && thinkingEnabled && hasToolCall && !hasThought) {
          content.parts.unshift({
            thought: true,
            text: 'Thinking Process...',
            thoughtSignature: 'skip_thought_signature_validator', // Mock signature or skip
          })
        }
      }
    }
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
