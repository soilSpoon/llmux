import { CredentialStorage } from '../storage'
import type { Credential, OAuthCredential } from '../types'
import { isOAuthCredential } from '../types'
import type { AuthMethod, AuthProvider, AuthResult } from './base'

const PROVIDER_ID = 'github-copilot'
const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98'

export interface DeviceCodeResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user',
    }),
  })

  const data = (await response.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

export async function pollForToken(deviceCode: string, interval: number): Promise<AuthResult> {
  const pollInterval = interval * 1000

  const poll = async (): Promise<AuthResult> => {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const data = (await response.json()) as {
      error?: string
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    if (data.error === 'authorization_pending') {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      return poll()
    }

    if (data.error === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, pollInterval + 5000))
      return poll()
    }

    if (data.error) {
      return { type: 'failed', error: data.error }
    }

    if (data.access_token) {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt: Date.now() + (data.expires_in || 28800) * 1000,
      }
      await CredentialStorage.set(PROVIDER_ID, credential)
      return { type: 'success', credential }
    }

    return { type: 'failed', error: 'Unknown error' }
  }

  return poll()
}

const deviceFlowMethod: AuthMethod = {
  type: 'device-flow',
  label: 'GitHub Device Flow',
  async authorize(): Promise<AuthResult> {
    try {
      const codeResponse = await requestDeviceCode()
      console.log(`Visit ${codeResponse.verificationUri} and enter code: ${codeResponse.userCode}`)
      return pollForToken(codeResponse.deviceCode, codeResponse.interval)
    } catch (error) {
      return { type: 'failed', error: String(error) }
    }
  },
}

export const GithubCopilotProvider: AuthProvider = {
  id: PROVIDER_ID,
  name: 'GitHub Copilot',
  methods: [deviceFlowMethod],

  async getCredential(): Promise<Credential | undefined> {
    return CredentialStorage.get(PROVIDER_ID)
  },

  async getHeaders(): Promise<Record<string, string>> {
    const credential = await this.getCredential()
    if (!credential || !isOAuthCredential(credential)) {
      return {}
    }
    return {
      Authorization: `Bearer ${credential.accessToken}`,
      'Editor-Version': 'llmux/1.0',
    }
  },

  getEndpoint(_model: string): string {
    return 'https://api.githubcopilot.com/chat/completions'
  },
}
