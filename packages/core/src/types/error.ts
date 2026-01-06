/**
 * UnifiedError - Standard error format for all provider errors
 */
export interface UnifiedError {
  /**
   * The name of the provider that returned the error (e.g., 'openai', 'anthropic')
   */
  provider: string

  /**
   * Standard error code
   */
  code:
    | 'invalid_request_error'
    | 'authentication_error'
    | 'permission_error'
    | 'rate_limit_error'
    | 'server_error'
    | 'context_length_exceeded'
    | 'unknown_error'

  /**
   * Original provider error code if available
   */
  providerCode?: string

  /**
   * HTTP status code
   */
  statusCode?: number

  /**
   * Human-readable error message
   */
  message: string

  /**
   * Whether the request can be retried
   */
  retryable: boolean

  /**
   * Original error object from the provider
   */
  originalError?: unknown
}

/**
 * Helper to check if an error is a UnifiedError
 */
export function isUnifiedError(error: unknown): error is UnifiedError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'provider' in error &&
    'code' in error &&
    'message' in error
  )
}
