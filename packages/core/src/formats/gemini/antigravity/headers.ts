import type { JsonObject } from 'type-fest'

/**
 * US-008: Header 프로파일 분리 (Antigravity)
 */

export function getAntigravityHeaders(accessToken: string): Record<string, string> {
  const metadata: JsonObject = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity/1.104.0 darwin/arm64',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify(metadata),
  }
}
