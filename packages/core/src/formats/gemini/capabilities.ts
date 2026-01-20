/**
 * US-002: Model Capabilities Resolver
 *
 * 모델명에 따른 전송 방식, 씽킹 설정 스타일, 툴 페어링 엄격성 등을 결정합니다.
 */

export interface GeminiCapabilities {
  transport: 'antigravity' | 'standard' | 'gemini-cli'
  modelVendor: 'anthropic' | 'google' | 'other'
  thinkingWireStyle: 'snake' | 'camel'
  thinkingParamStyle: 'budget' | 'level' | 'none'
  requiresStrictToolPairing: boolean
  requiresSystemInstructionObject: boolean
}

export function resolveGeminiFamilyCapabilities(modelId: string): GeminiCapabilities {
  const model = modelId.toLowerCase()
  const isClaude = model.includes('claude')
  const isGemini3 = model.includes('gemini-3')
  const isGemini25 = model.includes('gemini-2.5') || model.includes('gemini-2.0')
  const isThinking = model.includes('thinking')

  let thinkingParamStyle: GeminiCapabilities['thinkingParamStyle'] = 'none'

  if (isGemini3) {
    thinkingParamStyle = 'level'
  } else if (isGemini25) {
    thinkingParamStyle = 'budget'
  } else if (isClaude) {
    thinkingParamStyle = isThinking ? 'budget' : 'none'
  }

  // Antigravity for Claude, Gemini-CLI for Google models (by default in this setup)
  // Standard API support is future work
  const transport = isClaude ? 'antigravity' : 'gemini-cli'

  return {
    transport,
    modelVendor: isClaude ? 'anthropic' : 'google',
    thinkingWireStyle: isClaude ? 'snake' : 'camel',
    thinkingParamStyle,
    requiresStrictToolPairing: isClaude,
    requiresSystemInstructionObject: true,
  }
}
