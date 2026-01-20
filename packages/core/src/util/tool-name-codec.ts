import { createHash } from 'node:crypto'

/**
 * ToolNameCodec - 완전 가역 인코딩/디코딩
 *
 * Antigravity/Gemini API의 제약사항을 준수하면서 원본 툴 이름을 100% 보존합니다.
 * - 첫 글자 규칙: [A-Za-z]로 시작 필수
 * - 허용 문자: [a-zA-Z0-9_-] (base64url 사용)
 * - 최대 길이: 64자
 *
 * 전략:
 * 1. 모든 이름을 't' prefix + base64url(name) 형식으로 인코딩 시도.
 * 2. 인코딩 결과가 64자를 초과하면 'h' prefix + sha256(name).slice(0, 16) 형식을 사용하고 레지스트리에 저장.
 */
export class ToolNameCodec {
  private hashToOriginal = new Map<string, string>()

  /**
   * 원본 툴 이름을 API용 이름으로 인코딩합니다.
   */
  encode(original: string): string {
    // Base64url 인코딩 (A-Za-z0-9_- 만 사용)
    const b64 = Buffer.from(original, 'utf-8').toString('base64url')

    // 't' prefix: 첫 글자 규칙 충족 (letter로 시작 필수)
    const encoded = `t${b64}`

    if (encoded.length <= 64) {
      return encoded
    }

    // 64자 초과 시: hash 기반 registry lookup
    const hash = createHash('sha256').update(original).digest('base64url').slice(0, 16)

    this.hashToOriginal.set(hash, original)
    return `h${hash}` // 'h' = hash lookup indicator
  }

  /**
   * API용 이름을 원본 툴 이름으로 복원합니다.
   */
  decode(encoded: string): string {
    if (encoded.startsWith('t')) {
      const b64 = encoded.slice(1)
      return Buffer.from(b64, 'base64url').toString('utf-8')
    }

    if (encoded.startsWith('h')) {
      const hash = encoded.slice(1)
      const original = this.hashToOriginal.get(hash)

      if (!original) {
        // 이 경우는 레지스트리가 수명이 다했거나 초기화된 경우입니다.
        // 하지만 llmux 서비스 생명주기 내에서는 유지되어야 합니다.
        return `unknown_tool_${hash}`
      }

      return original
    }

    // Prefix가 없는 경우 (기존 호환성 또는 오류)
    return encoded
  }
}
