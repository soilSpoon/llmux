import {
  accumulateOpenAIResponse,
  type OpenAIChatCompletion,
  type OpenAIMessage,
  type OpenAIToolCall,
} from '@llmux/core'

// Re-export types from core for backward compatibility
export type { OpenAIChatCompletion, OpenAIMessage, OpenAIToolCall }
