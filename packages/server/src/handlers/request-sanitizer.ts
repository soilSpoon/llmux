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
import { validateAndFixClaudeToolPairing, validateToolPairingStrict } from './tool-pairing'

const logger = createLogger({ service: 'request-sanitizer' })

export interface SanitizeRequestOptions {
  messages?: Message[]
  contents?: Content[]
  model?: string
  projectId?: string
  signatureStore: SignatureStore
  reqId?: string
  provider?: string
}

export interface SanitizeRequestResult {
  messages?: Message[]
  contents?: Content[]
  strippedCount: number
  strategy: string
  toolPairingFixed: boolean
}

/**
 * Sanitize request before transformation.
 * - Claude: Strip ALL thinking blocks (Fresh Signature strategy)
 * - Other models: Project-based signature validation
 * - All models: Validate and fix tool pairing
 */
export function sanitizeRequestSignatures(options: SanitizeRequestOptions): SanitizeRequestResult {
  const { messages, contents, model, projectId, signatureStore, reqId, provider } = options

  const strategy = getThinkingStrategy(model, provider)
  const isClaudeFresh = strategy === 'claude-fresh'
  let toolPairingFixed = false

  // Skip if no content to process
  if (!messages && !contents) {
    return { strippedCount: 0, strategy, toolPairingFixed }
  }

  // Skip if not Claude and no projectId (can't validate)
  if (!isClaudeFresh && !projectId) {
    return { messages, contents, strippedCount: 0, strategy, toolPairingFixed }
  }

  const validationResult = validateAndStripSignatures({
    messages,
    contents,
    targetProjectId: projectId || 'claude-no-project',
    signatureStore,
    model,
    provider,
  })

  let processedMessages = validationResult.messages

  // For Claude, validate and fix tool pairing after thinking block stripping
  if (isClaudeFresh && processedMessages && processedMessages.length > 0) {
    // First check if there are any issues
    const pairingCheck = validateToolPairingStrict(processedMessages)

    if (!pairingCheck.valid) {
      logger.warn(
        {
          reqId,
          errorCount: pairingCheck.errors.length,
          errors: pairingCheck.errors.slice(0, 5), // Log first 5 errors
        },
        'Tool pairing validation failed, attempting fix'
      )

      // Apply fix
      processedMessages = validateAndFixClaudeToolPairing(processedMessages)
      toolPairingFixed = true

      // Re-validate after fix
      const recheck = validateToolPairingStrict(processedMessages)
      if (!recheck.valid) {
        logger.error(
          { reqId, remainingErrors: recheck.errors.length },
          'Tool pairing still invalid after fix - request may fail'
        )
      } else {
        logger.info({ reqId }, 'Tool pairing fixed successfully')
      }
    }
  }

  if (validationResult.strippedCount > 0) {
    logger.info(
      {
        reqId,
        projectId,
        strippedCount: validationResult.strippedCount,
        strategy,
        toolPairingFixed,
      },
      'Signature validation: stripped thinking/signatures'
    )
  }

  return {
    messages: processedMessages,
    contents: validationResult.contents,
    strippedCount: validationResult.strippedCount,
    strategy,
    toolPairingFixed,
  }
}
