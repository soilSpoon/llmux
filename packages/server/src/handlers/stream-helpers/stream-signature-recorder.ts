import type { SignatureStore } from '../../stores'
import { extractSignaturesFromSSE } from '../signature-response'

export interface SignatureContext {
  projectId: string
  provider: string
  endpoint: string
  account: string
  signatureStore: SignatureStore
  onSave?: (count: number) => void
}

export function recordSignaturesFromSSE(
  rawEvent: string,
  signatureContext: SignatureContext
): void {
  const signatures = extractSignaturesFromSSE(`data: ${rawEvent}`)
  for (const sig of signatures) {
    signatureContext.signatureStore.saveSignature({
      signature: sig,
      projectId: signatureContext.projectId,
      provider: signatureContext.provider,
      endpoint: signatureContext.endpoint,
      account: signatureContext.account,
    })
  }
  if (signatures.length > 0) {
    signatureContext.onSave?.(signatures.length)
  }
}
