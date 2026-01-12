/**
 * FormatId ↔ ProviderName 변환 유틸리티
 *
 * FormatId: wire format (요청/응답 스키마)
 * ProviderName: 제공자 identity (openai, anthropic, openai-web 등)
 */

import type { ProviderName } from '../types/providers'
import type { FormatId } from './base'

/**
 * FormatId를 기본 ProviderName으로 변환
 * NOTE: 여러 provider가 같은 format을 사용할 수 있음 (e.g., openai, openai-web 둘 다 openai-chat 사용)
 */
export function formatIdToProviderName(formatId: FormatId): ProviderName {
  switch (formatId) {
    case 'openai-chat':
      return 'openai'
    case 'openai-responses':
      return 'openai' // openai-responses도 openai provider 사용
    case 'anthropic-messages':
      return 'anthropic'
    case 'google-gemini':
      return 'gemini'
    default:
      throw new Error(`Unknown FormatId: ${formatId}`)
  }
}

/**
 * URL 경로에서 FormatId 감지
 */
export function detectFormatFromUrl(url: string): FormatId | null {
  if (url.includes('/v1/responses')) return 'openai-responses'
  if (url.includes('/v1/chat/completions')) return 'openai-chat'
  if (url.includes('/v1/messages') && !url.includes('/chat/completions'))
    return 'anthropic-messages'
  if (url.includes('generateContent')) return 'google-gemini'
  return null
}
