import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { CredentialStorage } from '@llmux/auth'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkOpenAIProviderAvailability,
  resolveOpenAIProvider,
  isRateLimited,
  isOpenAICompatibleProvider,
  isOpenAIModel,
} from '../../src/handlers/openai-fallback'

describe('OpenAI Fallback Logic', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-fallback-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('checkOpenAIProviderAvailability', () => {
    test('returns false for both when no credentials', async () => {
      const availability = await checkOpenAIProviderAvailability()
      expect(availability.openai).toBe(false)
      expect(availability['openai-web']).toBe(false)
    })

    test('returns true for openai when only openai credentials exist', async () => {
      await CredentialStorage.add('openai', { type: 'api', key: 'sk-test' })
      const availability = await checkOpenAIProviderAvailability()
      expect(availability.openai).toBe(true)
      expect(availability['openai-web']).toBe(false)
    })

    test('returns true for openai-web when only openai-web credentials exist', async () => {
      await CredentialStorage.add('openai-web', {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      })
      const availability = await checkOpenAIProviderAvailability()
      expect(availability.openai).toBe(false)
      expect(availability['openai-web']).toBe(true)
    })

    test('returns true for both when both credentials exist', async () => {
      await CredentialStorage.add('openai', { type: 'api', key: 'sk-test' })
      await CredentialStorage.add('openai-web', {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      })
      const availability = await checkOpenAIProviderAvailability()
      expect(availability.openai).toBe(true)
      expect(availability['openai-web']).toBe(true)
    })
  })

  describe('resolveOpenAIProvider', () => {
    test('returns openai with no fallback when only openai is available', async () => {
      await CredentialStorage.add('openai', { type: 'api', key: 'sk-test' })
      const result = await resolveOpenAIProvider()
      expect(result.primary).toBe('openai')
      expect(result.fallback).toBe(null)
    })

    test('returns openai-web with no fallback when only openai-web is available', async () => {
      await CredentialStorage.add('openai-web', {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      })
      const result = await resolveOpenAIProvider()
      expect(result.primary).toBe('openai-web')
      expect(result.fallback).toBe(null)
    })

    test('returns openai-web as primary with openai fallback when both available', async () => {
      await CredentialStorage.add('openai', { type: 'api', key: 'sk-test' })
      await CredentialStorage.add('openai-web', {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      })
      const result = await resolveOpenAIProvider()
      expect(result.primary).toBe('openai-web')
      expect(result.fallback).toBe('openai')
    })

    test('returns openai with no fallback when neither is available', async () => {
      const result = await resolveOpenAIProvider()
      expect(result.primary).toBe('openai')
      expect(result.fallback).toBe(null)
    })
  })

  describe('isRateLimited', () => {
    test('returns true for 429 response', () => {
      const response = new Response('Too Many Requests', { status: 429 })
      expect(isRateLimited(response)).toBe(true)
    })

    test('returns false for 200 response', () => {
      const response = new Response('OK', { status: 200 })
      expect(isRateLimited(response)).toBe(false)
    })

    test('returns false for 500 response', () => {
      const response = new Response('Error', { status: 500 })
      expect(isRateLimited(response)).toBe(false)
    })
  })

  describe('isOpenAICompatibleProvider', () => {
    test('returns true for openai', () => {
      expect(isOpenAICompatibleProvider('openai')).toBe(true)
    })

    test('returns true for openai-web', () => {
      expect(isOpenAICompatibleProvider('openai-web')).toBe(true)
    })

    test('returns false for anthropic', () => {
      expect(isOpenAICompatibleProvider('anthropic')).toBe(false)
    })

    test('returns false for gemini', () => {
      expect(isOpenAICompatibleProvider('gemini')).toBe(false)
    })
  })

  describe('isOpenAIModel', () => {
    test('returns true for gpt-4', () => {
      expect(isOpenAIModel('gpt-4')).toBe(true)
    })

    test('returns true for gpt-5', () => {
      expect(isOpenAIModel('gpt-5')).toBe(true)
    })

    test('returns true for gpt-5.1', () => {
      expect(isOpenAIModel('gpt-5.1')).toBe(true)
    })

    test('returns true for o1-preview', () => {
      expect(isOpenAIModel('o1-preview')).toBe(true)
    })

    test('returns true for o3-mini', () => {
      expect(isOpenAIModel('o3-mini')).toBe(true)
    })

    test('returns true for codex model', () => {
      expect(isOpenAIModel('gpt-5-codex')).toBe(true)
    })

    test('returns false for claude', () => {
      expect(isOpenAIModel('claude-3-opus')).toBe(false)
    })

    test('returns false for gemini', () => {
      expect(isOpenAIModel('gemini-pro')).toBe(false)
    })
  })
})
