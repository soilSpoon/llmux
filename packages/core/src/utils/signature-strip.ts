type StripSignature<T> = T extends { thoughtSignature?: infer _ } ? Omit<T, 'thoughtSignature'> : T
type ThinkingPart = { thought?: unknown; thoughtSignature?: string }

/**
 * Remove thoughtSignature from parts for cross-model fallback (Gemini format)
 * Always removes the thinking block entirely if it has a signature
 */
export function stripThoughtSignatures<T extends Record<string, unknown>>(
  parts: (T & { thoughtSignature?: string })[]
): StripSignature<T>[] {
  return parts.map((part) => {
    if (part.thoughtSignature) {
      // If it's a function call, we MUST keep the signature field (but sentinelized)
      // to satisfy Gemini 2.0 / Antigravity requirements.
      if ('functionCall' in part) {
        return {
          ...part,
          thoughtSignature: 'skip_thought_signature_validator',
        } as unknown as StripSignature<T>
      }

      // Always remove the thinking block entirely if it has a signature
      // This is safer for cross-model fallback as signatures are not portable
      const { thought, thoughtSignature, ...rest } = part as T & ThinkingPart
      return rest as StripSignature<T>
    }
    return part as StripSignature<T>
  })
}

/**
 * Strip signatures from entire contents array (Gemini/Antigravity format)
 */
export function stripSignaturesFromContents<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  contents: Array<{
    role: string
    parts: (T & { thoughtSignature?: string })[]
  }>
): Array<{
  role: string
  parts: Array<StripSignature<T>>
}> {
  return contents.map((content) => ({
    role: content.role,
    parts: stripThoughtSignatures(content.parts),
  }))
}

interface ContentBlock {
  type?: string
  signature?: string
  thinking?: string
  [key: string]: unknown
}

interface MessageWithContent {
  role: string
  content: ContentBlock[] | string
}

interface MessageResult {
  role: string
  content: ContentBlock[] | string
}

/**
 * Strip signatures from messages array (Anthropic format)
 * Removes thinking blocks with signature field to prevent cross-model signature errors
 */
export function stripSignaturesFromMessages(messages: MessageWithContent[]): MessageResult[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content }
    }

    const strippedContent = message.content.map((block) => {
      // Remove thinking blocks with signature (they're not portable across models)
      if (block.type === 'thinking' && block.signature) {
        const { signature, thinking, ...rest } = block
        return { ...rest, type: 'text' as const, text: thinking || '' }
      }
      return block
    })

    return { role: message.role, content: strippedContent }
  })
}
