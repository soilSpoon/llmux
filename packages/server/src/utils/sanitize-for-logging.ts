export function sanitizeForLogging<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value
  }

  // Handle Arrays
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogging(item)) as unknown as T
  }

  // Handle Objects
  const sanitized: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    // Strip known signature keys
    if (key === 'thoughtSignature' || key === 'thought_signature') {
      continue
    }

    // Recursively sanitize
    sanitized[key] = sanitizeForLogging(val)
  }

  return sanitized as T
}

/**
 * Helper to assert that a stringified log entry does not contain signatures
 */
export function assertNoThoughtSignatureString(logOutput: string): boolean {
  return !logOutput.includes('thoughtSignature') && !logOutput.includes('thought_signature')
}
