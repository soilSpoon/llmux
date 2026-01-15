import type { ProviderName } from '../types/providers'

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /**
   * Maximum number of retry attempts
   */
  maxAttempts: number

  /**
   * Whether to check budget before retrying
   */
  budgetCheckRequired: boolean
}

/**
 * Default retry policy
 */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  budgetCheckRequired: true,
}

/**
 * Get retry policy for a specific provider and model.
 *
 * @param provider - Provider name
 * @param model - Optional model name
 * @param deploymentId - Optional deployment ID
 * @returns RetryPolicy
 */
export function getRetryPolicy(
  _provider: ProviderName,
  _model?: string,
  _deploymentId?: string
): RetryPolicy {
  // Default policy for all providers for now
  // This can be extended with provider/model specific logic in the future
  return { ...DEFAULT_RETRY_POLICY }
}
