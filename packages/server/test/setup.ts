import {
  registerProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  AntigravityProvider,
} from '@llmux/core'

registerProvider(new OpenAIProvider())
registerProvider(new AnthropicProvider())
registerProvider(new GeminiProvider())
registerProvider(new AntigravityProvider())
