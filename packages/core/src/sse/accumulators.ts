// Gemini Response Types
export interface GeminiResponseShape {
  candidates?: Array<{
    content?: { parts?: Array<Record<string, unknown>> }
    finishReason?: string
  }>
  usageMetadata?: Record<string, unknown>
}

// OpenAI Response Types
export interface OpenAIToolCall {
  index: number
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

export interface AccumulatedOpenAIMessage {
  role: string
  content: string | null
  tool_calls?: OpenAIToolCall[]
}

export interface OpenAIChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: AccumulatedOpenAIMessage
    finish_reason: string | null
  }>
  usage?: Record<string, unknown>
}

interface AccumulatedChoice {
  role: string
  content: string
  tool_calls: Record<number, OpenAIToolCall>
  finish_reason: string | null
}

interface ChunkChoice {
  index: number
  delta: {
    role?: string
    content?: string
    tool_calls?: Array<{
      index: number
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
  finish_reason: string | null
}

interface Chunk {
  id: string
  created: number
  model: string
  choices: ChunkChoice[]
  usage?: Record<string, unknown>
}

/**
 * Accumulates a Gemini-style SSE stream into a single JSON response object.
 */
export async function accumulateGeminiResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<GeminiResponseShape | null> {
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResponse: GeminiResponseShape | null = null
  let accumulatedParts: Array<Record<string, unknown>> = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
        try {
          const chunk = JSON.parse(line.slice(6))
          const actual = chunk.response || chunk
          if (!finalResponse) {
            finalResponse = actual as GeminiResponseShape
            accumulatedParts = actual.candidates?.[0]?.content?.parts || []
          } else {
            accumulatedParts.push(...(actual.candidates?.[0]?.content?.parts || []))
            if (actual.candidates?.[0]?.finishReason && finalResponse.candidates?.[0]) {
              finalResponse.candidates[0].finishReason = actual.candidates[0].finishReason
            }
            if (actual.usageMetadata) finalResponse.usageMetadata = actual.usageMetadata
          }
        } catch {}
      }
    }

    if (finalResponse && accumulatedParts.length && finalResponse.candidates?.[0]?.content) {
      finalResponse.candidates[0].content.parts = accumulatedParts
    }
  } catch (error) {
    // Return partial result if possible, or null
    console.error('Error accumulating Gemini response:', error)
  }

  return finalResponse
}

/**
 * Accumulates an OpenAI-style SSE stream into a single JSON response object.
 */
export async function accumulateOpenAIResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<OpenAIChatCompletion | null> {
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResponse: OpenAIChatCompletion | null = null
  const choicesMap = new Map<number, AccumulatedChoice>()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const chunk = JSON.parse(data) as Chunk

          // Initialize top-level fields from the first chunk
          if (!finalResponse) {
            finalResponse = {
              id: chunk.id,
              object: 'chat.completion',
              created: chunk.created,
              model: chunk.model,
              choices: [],
              usage: undefined,
            }
          }

          // Accumulate choices
          if (Array.isArray(chunk.choices)) {
            for (const choice of chunk.choices) {
              const index = choice.index || 0
              let currentChoice = choicesMap.get(index)

              if (!currentChoice) {
                currentChoice = {
                  role: 'assistant',
                  content: '',
                  tool_calls: {},
                  finish_reason: null,
                }
                choicesMap.set(index, currentChoice)
              }

              const delta = choice.delta || {}

              if (delta.role) {
                currentChoice.role = delta.role
              }

              if (delta.content) {
                currentChoice.content += delta.content
              }

              if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const toolIndex = toolCall.index
                  if (!currentChoice.tool_calls[toolIndex]) {
                    currentChoice.tool_calls[toolIndex] = {
                      index: toolIndex,
                      id: toolCall.id || '',
                      type: toolCall.type || 'function',
                      function: {
                        name: toolCall.function?.name || '',
                        arguments: toolCall.function?.arguments || '',
                      },
                    }
                  } else {
                    if (toolCall.function?.arguments) {
                      currentChoice.tool_calls[toolIndex].function.arguments +=
                        toolCall.function.arguments
                    }
                  }
                }
              }

              if (choice.finish_reason) {
                currentChoice.finish_reason = choice.finish_reason
              }
            }
          }

          // Update usage if present (often in last chunk)
          if (chunk.usage) {
            finalResponse.usage = chunk.usage
          }
        } catch {
          // Ignore parse errors for individual lines
        }
      }
    }
  } catch {
    // If stream reading fails, return what we have so far
  }

  if (finalResponse) {
    // Convert map to array
    finalResponse.choices = Array.from(choicesMap.entries()).map(([index, choice]) => {
      const message: AccumulatedOpenAIMessage = {
        role: choice.role,
        content: choice.content || null,
      }

      const toolCalls = Object.values(choice.tool_calls)
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls
      }

      return {
        index,
        message,
        finish_reason: choice.finish_reason,
      }
    })
  }

  return finalResponse
}
