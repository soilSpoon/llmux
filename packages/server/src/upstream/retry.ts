export function parseRetryAfterMs(response?: Response | null, body?: string): number {
  if (!response || !response.headers) return 30000

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

    const quotaResetMatch = body.match(/reset after (\d+)s/)
    if (quotaResetMatch?.[1]) return parseInt(quotaResetMatch[1], 10) * 1000
  }

  // 4. Default fallback (30 seconds)
  return 30000
}

/**
 * Check if a response indicates rate limiting (429)
 */
export function isRateLimited(response: Response): boolean {
  return response.status === 429
}
