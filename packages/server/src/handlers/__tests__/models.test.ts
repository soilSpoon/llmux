import { describe, expect, it } from 'bun:test'
import type { Credential } from '@llmux/auth'
import type { CredentialProvider } from '../../auth'
import type { ModelsResponse } from '../../models/types'
import { handleModels } from '../models'

function createMockCredentialProvider(
  credentials: Record<string, Credential[]>
): CredentialProvider {
  return {
    getCredential: async (provider) => {
      const creds = credentials[provider]
      return creds?.[0] ?? null
    },
    getAccessToken: async (provider) => {
      const cred = credentials[provider]?.[0]
      if (!cred) return null
      if (cred.type === 'oauth') return cred.accessToken
      if (cred.type === 'api') return cred.key
      return null
    },
    getAllCredentials: async () => credentials,
  }
}

function createRequest(): Request {
  return new Request('http://localhost/v1/models', { method: 'GET' })
}

async function parseResponse(response: Response): Promise<ModelsResponse> {
  return (await response.json()) as ModelsResponse
}

describe('handleModels', () => {
  describe('빈 credentials 처리', () => {
    it('빈 credentials일 때 빈 모델 목록과 빈 providers 반환', async () => {
      const credentialProvider = createMockCredentialProvider({})
      const request = createRequest()

      const response = await handleModels(request, { credentialProvider })
      const body = await parseResponse(response)

      expect(response.status).toBe(200)
      expect(body.object).toBe('list')
      expect(body.data).toEqual([])
      expect(body.providers).toEqual([])
    })
  })

  describe('단일 provider 모델 반환', () => {
    it('antigravity credentials가 있을 때 antigravity 모델 반환', async () => {
      const credentialProvider = createMockCredentialProvider({
        antigravity: [
          {
            type: 'oauth',
            accessToken: 'test-token',
            refreshToken: '',
            expiresAt: Date.now() + 3600000,
          },
        ],
      })
      const request = createRequest()

      const response = await handleModels(request, { credentialProvider })
      const body = await parseResponse(response)

      expect(response.status).toBe(200)
      expect(body.object).toBe('list')
      expect(body.providers).toContain('antigravity')
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((m) => m.provider === 'antigravity')).toBe(true)
    })
  })

  describe('여러 provider 모델 병합', () => {
    it('여러 provider credentials가 있을 때 모든 모델 병합', async () => {
      const credentialProvider = createMockCredentialProvider({
        antigravity: [
          {
            type: 'oauth',
            accessToken: 'token-1',
            refreshToken: '',
            expiresAt: Date.now() + 3600000,
          },
        ],
        openai: [{ type: 'api', key: 'sk-test' }],
      })
      const request = createRequest()

      const response = await handleModels(request, { credentialProvider })
      const body = await parseResponse(response)

      expect(response.status).toBe(200)
      expect(body.providers).toContain('antigravity')
      expect(body.providers).toContain('openai')

      const providers = new Set(body.data.map((m) => m.provider))
      expect(providers.size).toBeGreaterThanOrEqual(2)
    })
  })

  describe('modelMappings 적용', () => {
    it('modelMappings로 모델 id 변환', async () => {
      const credentialProvider = createMockCredentialProvider({
        antigravity: [
          {
            type: 'oauth',
            accessToken: 'test-token',
            refreshToken: '',
            expiresAt: Date.now() + 3600000,
          },
        ],
      })
      const request = createRequest()

      const response = await handleModels(request, {
        credentialProvider,
        modelMappings: [{ from: 'gpt-4', to: 'antigravity/gpt-4' }],
      })
      const body = await parseResponse(response)

      expect(response.status).toBe(200)
      // 매핑 정보가 응답에 포함되어야 함
      expect(body.mappings).toBeDefined()
      expect(body.mappings?.['gpt-4']).toBe('antigravity/gpt-4')
    })
  })

  describe('API 에러 처리', () => {
    it('특정 provider 에러 시 해당 provider만 스킵하고 나머지 반환', async () => {
      // 에러를 발생시키는 provider mock
      const credentialProvider: CredentialProvider = {
        getCredential: async () => null,
        getAccessToken: async (provider) => {
          if (provider === 'openai') {
            throw new Error('API Error')
          }
          return 'valid-token'
        },
        getAllCredentials: async () => ({
          openai: [{ type: 'api' as const, key: 'invalid-key' }],
          antigravity: [
            {
              type: 'oauth' as const,
              accessToken: 'valid-token',
              refreshToken: '',
              expiresAt: Date.now() + 3600000,
            },
          ],
        }),
      }
      const request = createRequest()

      const response = await handleModels(request, { credentialProvider })
      const body = await parseResponse(response)

      expect(response.status).toBe(200)
      // openai는 에러로 스킵되고 antigravity만 반환
      expect(body.providers).toContain('antigravity')
      expect(body.providers).not.toContain('openai')
    })
  })
})
