import {
  clearProviders,
  registerProvider,
  OpenAIProvider,
  OpenAIWebProvider,
  AnthropicProvider,
  GeminiProvider,
  AntigravityProvider,
  OpencodeZenProvider,
} from '@llmux/core'
import { registerServerStrategies } from '../src/strategies/register'

clearProviders()
registerProvider(new OpenAIProvider())
registerProvider(new OpenAIWebProvider())
registerProvider(new AnthropicProvider())
registerProvider(new GeminiProvider())
registerProvider(new AntigravityProvider())
registerProvider(new OpencodeZenProvider())

registerServerStrategies()
