export function parseRetryAfterMs(response?: Response | null, body?: string): number | undefined {
  if (!response || !response.headers) return undefined

  // 1. Check retry-after-ms header
  const retryAfterMsHeader = response.headers.get('retry-after-ms')
  if (retryAfterMsHeader) {
    const parsed = parseInt(retryAfterMsHeader, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }

  // 2. Check retry-after header (seconds)
  const retryAfterHeader = response.headers.get('retry-after')
  if (retryAfterHeader) {
    const parsed = parseInt(retryAfterHeader, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000
  }

  // 3. Check body for retryDelay or Gemini quota reset message
  if (body) {
    const retryDelayMatch = body.match(/"retryDelay":\s*"([0-9.]+)s"/)
    if (retryDelayMatch?.[1]) return parseFloat(retryDelayMatch[1]) * 1000

    const quotaResetMatch = body.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/)
    if (quotaResetMatch) {
      const hours = parseInt(quotaResetMatch[1] || '0', 10)
      const minutes = parseInt(quotaResetMatch[2] || '0', 10)
      const seconds = parseInt(quotaResetMatch[3] || '0', 10)
      const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000
      if (totalMs > 0) return totalMs
    }
  }

  // 4. No explicit retry time found
  return undefined
}

/**
 * Check if a response indicates rate limiting (429)
 */
export function isRateLimited(response: Response): boolean {
  return response.status === 429
}
