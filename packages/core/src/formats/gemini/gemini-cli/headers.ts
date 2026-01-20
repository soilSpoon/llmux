/**
 * US-008: Header 프로파일 분리 (Gemini-CLI)
 */

import type { JsonObject } from 'type-fest'

export function getGeminiCliHeaders(accessToken: string): Record<string, string> {
  const metadata: JsonObject = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'gl-node/22.17.0',
    'Client-Metadata': JSON.stringify(metadata),
  }
}
