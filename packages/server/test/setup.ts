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

process.env.LLMUX_TEST_NO_LISTEN = '1'

clearProviders()
registerProvider(new OpenAIProvider())
registerProvider(new OpenAIWebProvider())
registerProvider(new AnthropicProvider())
registerProvider(new GeminiProvider())
registerProvider(new AntigravityProvider())
registerProvider(new AntigravityProvider('gemini-cli'))
registerProvider(new OpencodeZenProvider())
registerProvider(new OpenAIProvider('github-copilot'))

registerServerStrategies()
