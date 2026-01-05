/**
 * Pre-Transform Request Sanitization
 *
 * Single entry point for signature/thinking sanitization before request transformation.
 * Called by both streaming and proxy handlers.
 */

import { createLogger } from '@llmux/core'
import type { SignatureStore } from '../stores/signature-store'
import { validateAndStripSignatures } from './signature-request'
import { type Content, getThinkingStrategy, type Message } from './thinking-utils'

const logger = createLogger({ service: 'request-sanitizer' })

export interface SanitizeRequestOptions {
  messages?: Message[]
  contents?: Content[]
  model?: string
  projectId?: string
  signatureStore: SignatureStore
  reqId?: string
}

export interface SanitizeRequestResult {
  messages?: Message[]
  contents?: Content[]
  strippedCount: number
  strategy: string
}

/**
 * Sanitize request before transformation.
 * - Claude: Strip ALL thinking blocks (Fresh Signature strategy)
 * - Other models: Project-based signature validation
 */
export function sanitizeRequestSignatures(options: SanitizeRequestOptions): SanitizeRequestResult {
  const { messages, contents, model, projectId, signatureStore, reqId } = options

  const strategy = getThinkingStrategy(model)
  const isClaudeFresh = strategy === 'claude-fresh'

  // Skip if no content to process
  if (!messages && !contents) {
    return { strippedCount: 0, strategy }
  }

  // Skip if not Claude and no projectId (can't validate)
  if (!isClaudeFresh && !projectId) {
    return { messages, contents, strippedCount: 0, strategy }
  }

  const validationResult = validateAndStripSignatures({
    messages,
    contents,
    targetProjectId: projectId || 'claude-no-project',
    signatureStore,
    model,
  })

  if (validationResult.strippedCount > 0) {
    logger.info(
      { reqId, projectId, strippedCount: validationResult.strippedCount, strategy },
      'Signature validation: stripped thinking/signatures'
    )
  }

  return {
    messages: validationResult.messages,
    contents: validationResult.contents,
    strippedCount: validationResult.strippedCount,
    strategy,
  }
}
