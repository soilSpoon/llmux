export type RequestFormat = 'openai' | 'anthropic' | 'gemini' | 'antigravity'

interface RequestBody {
  model?: string
  messages?: unknown[]
  system?: unknown
  contents?: unknown[]
  payload?: {
    contents?: unknown[]
  }
}

export function detectFormat(body: unknown): RequestFormat {
  if (!body || typeof body !== 'object') {
    throw new Error('Unknown request format')
  }

  const b = body as RequestBody

  if (b.payload && typeof b.payload === 'object' && b.payload.contents) {
    return 'antigravity'
  }

  if (b.contents && Array.isArray(b.contents)) {
    return 'gemini'
  }

  if (b.model && b.messages && Array.isArray(b.messages)) {
    if ('system' in b) {
      return 'anthropic'
    }
    return 'openai'
  }

  throw new Error('Unknown request format')
}
