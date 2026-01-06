/**
 * NoopStrategy
 *
 * No-operation strategy for providers that don't support thinking blocks.
 * Passes through all content without modification.
 */

import type { SignatureStore } from '../../stores/signature-store'
import type {
  SignatureProcessResult,
  ThinkingContent,
  ThinkingMessage,
} from '../types/thinking-types'
import type { ThinkingStrategy } from './thinking-strategy'
import { registerThinkingStrategy } from './thinking-strategy'

export class NoopStrategy implements ThinkingStrategy {
  readonly name = 'none' as const

  processRequestContents(
    contents: ThinkingContent[],
    _projectId: string,
    _signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingContent> {
    return { processed: contents, strippedCount: 0 }
  }

  processRequestMessages(
    messages: ThinkingMessage[],
    _projectId: string,
    _signatureStore: SignatureStore
  ): SignatureProcessResult<ThinkingMessage> {
    return { processed: messages, strippedCount: 0 }
  }

  normalizeResponseContents(contents: ThinkingContent[]): ThinkingContent[] {
    return contents
  }

  normalizeResponseMessages(messages: ThinkingMessage[]): ThinkingMessage[] {
    return messages
  }

  recoverConversation<T extends ThinkingContent | ThinkingMessage>(contents: T[]): T[] {
    return contents
  }
}

const noopStrategy = new NoopStrategy()
registerThinkingStrategy(noopStrategy)

export { noopStrategy }
