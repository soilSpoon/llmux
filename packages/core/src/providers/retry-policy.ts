import type { ProviderName } from '../types/providers'
import { isZeroCostModel } from '../util/model-capabilities'

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
  model?: string,
  _deploymentId?: string
): RetryPolicy {
  // Start with default policy
  const policy = { ...DEFAULT_RETRY_POLICY }

  // Zero-cost models don't need budget checks
  if (model && isZeroCostModel(model)) {
    policy.budgetCheckRequired = false
  }

  return policy
}
