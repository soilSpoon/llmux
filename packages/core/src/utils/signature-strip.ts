type StripSignature<T> = T extends { thoughtSignature: infer _ } ? Omit<T, 'thoughtSignature'> : T

/**
 * Remove thoughtSignature from parts for cross-model fallback
 * Preserves thought: true and text content
 */
export function stripThoughtSignatures<T extends Record<string, unknown>>(
  parts: (T & { thoughtSignature?: string })[]
): StripSignature<T>[] {
  return parts.map((part) => {
    if (part.thoughtSignature) {
      const { thoughtSignature, ...rest } = part
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
