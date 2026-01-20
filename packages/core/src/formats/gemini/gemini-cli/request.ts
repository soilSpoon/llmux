import type { JSONSchemaProperty } from '../../../types/json-schema.js'
import type { UnifiedRequest } from '../../../types/unified.js'
import { ToolNameCodec } from '../../../util/tool-name-codec.js'
import { enforceToolPairingAdjacency } from '../../../util/tool-pairing.js'
import type { EnvelopeOptions } from '../antigravity/envelope.js'
import { resolveGeminiFamilyCapabilities } from '../capabilities.js'
import { cleanSchemaForAntigravity } from '../shared/schema-sanitizer.js'
import type { GeminiCliContent, GeminiCliPart, GeminiCliRequest, GeminiCliTool } from './types.js'

/**
 * US-011 variant: Unified Request Builder for Gemini-CLI
 * (Standard/CLI format: No container envelope, camelCase config)
 */

const codec = new ToolNameCodec()

export function buildGeminiCliRequest(
  req: UnifiedRequest,
  options: EnvelopeOptions
): GeminiCliRequest {
  const caps = resolveGeminiFamilyCapabilities(options.model)

  // 1. Message Processing
  // Even for CLI, we enforce adjacency if capabilities say so (e.g. strict tool pairing might be enabled for robustness)
  // But Gemini is usually lenient. Let's trust caps.
  const messages = enforceToolPairingAdjacency(req.messages, caps.requiresStrictToolPairing)

  // 2. Build Contents
  const contents: GeminiCliContent[] = messages.map((msg) => {
    const parts: GeminiCliPart[] = []
    for (const p of msg.parts) {
      if (p.type === 'text') {
        parts.push({ text: p.text ?? '' })
      } else if (p.type === 'tool_call' && p.toolCall) {
        parts.push({
          functionCall: {
            id: p.toolCall.id, // Optional in CLI/Std but good to keep
            name: codec.encode(p.toolCall.name),
            args:
              typeof p.toolCall.arguments === 'string'
                ? JSON.parse(p.toolCall.arguments)
                : p.toolCall.arguments,
          },
        })
      } else if (p.type === 'tool_result' && p.toolResult) {
        parts.push({
          functionResponse: {
            id: p.toolResult.toolCallId,
            name: codec.encode('unknown_function'), // Should recover
            response: {
              content:
                typeof p.toolResult.content === 'string'
                  ? { result: p.toolResult.content } // Standard requires object wrapping often
                  : { result: JSON.stringify(p.toolResult.content) },
            },
          },
        })
      }
      // Thinking blocks usually filtered or passed as text?
      // For standard Gemini, thought parts are not standard input yet, usually separate field or omitted.
    }

    return {
      role: msg.role === 'assistant' ? 'model' : 'user', // Parts differentiate tool responses

      parts,
    }
  })

  // 3. System Instruction (camelCase)
  let systemInstruction: { parts: { text: string }[] } | undefined
  if (req.system) {
    systemInstruction = { parts: [{ text: req.system }] }
  }

  // 4. Tools
  let tools: GeminiCliTool[] | undefined
  if (req.tools && req.tools.length > 0) {
    tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: codec.encode(t.name),
          description: t.description,
          parameters: cleanSchemaForAntigravity(t.parameters as JSONSchemaProperty), // Re-use sanitizer as it does general cleanup
        })),
      },
    ]
  }

  // 5. Generation Config (camelCase)
  const generationConfig: GeminiCliRequest['generationConfig'] = {
    temperature: req.config?.temperature,
    topP: req.config?.topP,
    maxOutputTokens: req.config?.maxTokens,
    stopSequences: req.config?.stopSequences,
  }

  if (req.thinking?.enabled) {
    // Logic from gemini.ts but adapting to camelCase keys
    if (caps.thinkingParamStyle === 'budget') {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: req.thinking.budget,
      }
    } else if (caps.thinkingParamStyle === 'level') {
      const levelMap: Record<string, 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'> = {
        minimal: 'MINIMAL',
        low: 'LOW',
        medium: 'MEDIUM',
        high: 'HIGH',
      }
      const level = req.thinking.level ? levelMap[req.thinking.level] : 'LOW'
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: level || 'LOW',
      }
    }
  }

  return {
    contents,
    systemInstruction,
    tools,
    generationConfig,
  }
}
