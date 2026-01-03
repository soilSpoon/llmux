import { createLogger } from '@llmux/core'
import type { SignatureStore } from '../stores/signature-store'

const logger = createLogger({ service: 'signature-response' })

export interface SignatureContext {
  projectId: string
  provider: string
  endpoint: string
  account: string
}

export function extractSignaturesFromSSE(sseData: string): string[] {
  const signatures: string[] = []

  if (!sseData.trim() || sseData.trim() === 'data: [DONE]') {
    return signatures
  }

  try {
    const dataMatch = sseData.match(/^data:\s*(.+)$/m)
    if (!dataMatch || !dataMatch[1]) {
      return signatures
    }

    const jsonStr = dataMatch[1].trim()
    if (jsonStr === '[DONE]') {
      return signatures
    }

    const data = JSON.parse(jsonStr)

    extractSignaturesFromObject(data, signatures)
  } catch {
    // Malformed JSON, return empty array
  }

  return [...new Set(signatures)]
}

function extractSignaturesFromObject(obj: unknown, signatures: string[]): void {
  if (!obj || typeof obj !== 'object') {
    return
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractSignaturesFromObject(item, signatures)
    }
    return
  }

  const record = obj as Record<string, unknown>

  // Check for thoughtSignature (camelCase - Gemini/Antigravity response format)
  if (typeof record.thoughtSignature === 'string' && record.thoughtSignature) {
    signatures.push(record.thoughtSignature)
  }

  // Check for thought_signature (snake_case - alternative format)
  if (typeof record.thought_signature === 'string' && record.thought_signature) {
    signatures.push(record.thought_signature)
  }

  // Check for signature (Anthropic format in thinking blocks)
  if (typeof record.signature === 'string' && record.signature) {
    signatures.push(record.signature)
  }

  // Check in delta object (for signature_delta events)
  if (record.delta && typeof record.delta === 'object') {
    const delta = record.delta as Record<string, unknown>
    if (typeof delta.signature === 'string' && delta.signature) {
      signatures.push(delta.signature)
    }
  }

  // Check in content_block (Anthropic format)
  if (record.content_block && typeof record.content_block === 'object') {
    const contentBlock = record.content_block as Record<string, unknown>
    if (typeof contentBlock.signature === 'string' && contentBlock.signature) {
      signatures.push(contentBlock.signature)
    }
  }

  // Recursively check nested objects
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      extractSignaturesFromObject(value, signatures)
    }
  }
}

export function saveSignaturesFromResponse(
  sseData: string,
  context: SignatureContext,
  store: SignatureStore
): number {
  const signatures = extractSignaturesFromSSE(sseData)

  let savedCount = 0
  for (const signature of signatures) {
    if (!signature || signature.trim() === '') {
      continue
    }

    store.saveSignature({
      signature,
      projectId: context.projectId,
      provider: context.provider,
      endpoint: context.endpoint,
      account: context.account,
    })

    logger.debug(
      {
        projectId: context.projectId,
        provider: context.provider,
        signaturePrefix: signature.slice(0, 20),
      },
      `Saved signature for project: ${context.projectId}`
    )

    savedCount++
  }

  return savedCount
}
