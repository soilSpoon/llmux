import { createLogger } from '@llmux/core'
import type { SignatureStore } from '../stores/signature-store'

const logger = createLogger({ service: 'signature-request' })

export interface Part {
  text?: string
  thought?: boolean
  thought_signature?: string
  thoughtSignature?: string
  signature?: string
  thinking?: string
  [key: string]: unknown
}

export interface Content {
  role?: string
  parts?: Part[]
  [key: string]: unknown
}

export interface Block {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  thought_signature?: string
  thoughtSignature?: string
  [key: string]: unknown
}

export interface Message {
  role?: string
  content?: Block[] | string
  [key: string]: unknown
}

export interface ValidateSignatureOptions {
  contents?: Content[]
  messages?: Message[]
  targetProjectId: string
  signatureStore: SignatureStore
}

export interface ValidateSignatureResult {
  contents?: Content[]
  messages?: Message[]
  strippedCount: number
}

export function validateAndStripSignatures(
  options: ValidateSignatureOptions
): ValidateSignatureResult {
  const { contents, messages, targetProjectId, signatureStore } = options
  let strippedCount = 0

  const processedContents = contents
    ? processContents(contents, targetProjectId, signatureStore, (count) => {
        strippedCount += count
      })
    : undefined

  const processedMessages = messages
    ? processMessages(messages, targetProjectId, signatureStore, (count) => {
        strippedCount += count
      })
    : undefined

  return {
    contents: processedContents,
    messages: processedMessages,
    strippedCount,
  }
}

function processContents(
  contents: Content[],
  targetProjectId: string,
  signatureStore: SignatureStore,
  onStrip: (count: number) => void
): Content[] {
  return contents.map((content) => {
    if (!content || typeof content !== 'object') return content

    if (!Array.isArray(content.parts)) {
      return content
    }

    const processedParts = content.parts
      .map((part) => {
        if (!part || typeof part !== 'object') return part

        const signature = getSignatureFromPart(part)
        if (!signature) return part

        if (!signatureStore.isValidForProject(signature, targetProjectId)) {
          const record = signatureStore.getRecord(signature)
          const storedProjectId = record?.projectId ?? 'unknown'

          logger.trace(
            {
              storedProjectId,
              targetProjectId,
              signaturePrefix: signature.slice(0, 20),
            },
            `Stripped invalid signature (project mismatch): stored=${storedProjectId}, target=${targetProjectId}`
          )

          onStrip(1)
          return stripSignatureFromPart(part)
        }

        return part
      })
      .filter((part) => {
        if (!part || typeof part !== 'object') return true
        return Object.keys(part).length > 0
      })

    return { ...content, parts: processedParts }
  })
}

function processMessages(
  messages: Message[],
  targetProjectId: string,
  signatureStore: SignatureStore,
  onStrip: (count: number) => void
): Message[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message

    if (typeof message.content === 'string' || !Array.isArray(message.content)) {
      return message
    }

    const processedContent = message.content
      .map((block) => {
        if (!block || typeof block !== 'object') return block

        const signature = getSignatureFromBlock(block)
        if (!signature) return block

        if (!signatureStore.isValidForProject(signature, targetProjectId)) {
          const record = signatureStore.getRecord(signature)
          const storedProjectId = record?.projectId ?? 'unknown'

          logger.trace(
            {
              storedProjectId,
              targetProjectId,
              signaturePrefix: signature.slice(0, 20),
            },
            `Stripped invalid signature (project mismatch): stored=${storedProjectId}, target=${targetProjectId}`
          )

          onStrip(1)
          return stripSignatureFromBlock(block)
        }

        return block
      })
      .filter((block) => {
        if (!block || typeof block !== 'object') return true
        return Object.keys(block).length > 0
      })

    return { ...message, content: processedContent }
  })
}

function getSignatureFromPart(part: Part): string | undefined {
  return part.thoughtSignature || part.thought_signature || part.signature
}

function getSignatureFromBlock(block: Block): string | undefined {
  return block.signature || block.thoughtSignature || block.thought_signature
}

function stripSignatureFromPart(part: Part): Part {
  const { thoughtSignature, thought_signature, signature, ...rest } = part
  return rest
}

function stripSignatureFromBlock(block: Block): Block {
  const { signature, thoughtSignature, thought_signature, ...rest } = block
  return rest
}
