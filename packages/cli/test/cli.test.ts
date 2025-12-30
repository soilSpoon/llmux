import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { AuthProviderRegistry, CredentialStorage, OpenAIWebProvider } from '@llmux/auth'
import { ConfigLoader } from '@llmux/server'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('CLI', () => {
  describe('auth list', () => {
    const testDir = join(tmpdir(), 'llmux-cli-test')
    const originalHome = process.env.HOME

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true })
      process.env.HOME = testDir
    })

    afterEach(async () => {
      process.env.HOME = originalHome
      await rm(testDir, { recursive: true, force: true })
    })

    it('should show empty credentials message when no credentials exist', async () => {
      const credentials = await CredentialStorage.all()
      expect(Object.keys(credentials).length).toBe(0)
    })

    it('should list stored credentials', async () => {
      await CredentialStorage.add('test-provider', {
        type: 'api',
        key: 'test-key',
      })

      const credentials = await CredentialStorage.all()
      expect(Object.keys(credentials).length).toBe(1)
      expect(credentials['test-provider']).toEqual([{
        type: 'api',
        key: 'test-key',
      }])
    })
  })

  describe('auth login/logout', () => {
    const testDir = join(tmpdir(), 'llmux-cli-test-login')
    const originalHome = process.env.HOME

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true })
      process.env.HOME = testDir
    })

    afterEach(async () => {
      process.env.HOME = originalHome
      await rm(testDir, { recursive: true, force: true })
    })

    it('should store API key credential', async () => {
      await CredentialStorage.add('my-provider', {
        type: 'api',
        key: 'my-api-key',
      })

      const credentials = await CredentialStorage.get('my-provider')
      expect(credentials).toEqual([{
        type: 'api',
        key: 'my-api-key',
      }])
    })

    it('should remove credential on logout', async () => {
      await CredentialStorage.add('my-provider', {
        type: 'api',
        key: 'my-api-key',
      })

      await CredentialStorage.remove('my-provider')
      const credentials = await CredentialStorage.get('my-provider')
      expect(credentials).toEqual([])
    })
  })

  describe('config', () => {
    const testDir = join(tmpdir(), 'llmux-cli-config-test')
    const originalHome = process.env.HOME

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true })
      process.env.HOME = testDir
    })

    afterEach(async () => {
      process.env.HOME = originalHome
      await rm(testDir, { recursive: true, force: true })
    })

    it('should return default config when no file exists', async () => {
      const config = await ConfigLoader.load()
      expect(config.server.port).toBe(8743)
      expect(config.server.hostname).toBe('localhost')
    })

    it('should save and load config', async () => {
      await ConfigLoader.set('server', {
        port: 9000,
        hostname: '0.0.0.0',
        cors: true,
      })

      const config = await ConfigLoader.load()
      expect(config.server.port).toBe(9000)
      expect(config.server.hostname).toBe('0.0.0.0')
    })

    it('should get default config values', async () => {
      const defaultConfig = ConfigLoader.getDefault()
      expect(defaultConfig.server.hostname).toBe('localhost')
      expect(defaultConfig.routing.fallbackOrder).toContain('anthropic')
    })

    it('should get routing config', async () => {
      const routing = await ConfigLoader.get('routing')
      expect(routing.fallbackOrder).toContain('anthropic')
      expect(routing.rotateOn429).toBe(true)
    })
  })

  describe('openai-web provider', () => {
    const testDir = join(tmpdir(), 'llmux-cli-openai-web-test')
    const originalHome = process.env.HOME

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true })
      process.env.HOME = testDir
      AuthProviderRegistry.register(OpenAIWebProvider)
    })

    afterEach(async () => {
      process.env.HOME = originalHome
      await rm(testDir, { recursive: true, force: true })
      AuthProviderRegistry.clear()
    })

    it('openai-web provider is registered', () => {
      const provider = AuthProviderRegistry.get('openai-web')
      expect(provider).toBeDefined()
      expect(provider?.id).toBe('openai-web')
      expect(provider?.name).toBe('OpenAI (Web)')
    })

    it('openai-web provider has oauth method', () => {
      const provider = AuthProviderRegistry.get('openai-web')
      expect(provider?.methods).toHaveLength(1)
      expect(provider?.methods[0]?.type).toBe('oauth')
      expect(provider?.methods[0]?.label).toBe('ChatGPT Plus/Pro (Web Login)')
    })

    it('should store openai-web OAuth credential', async () => {
      await CredentialStorage.add('openai-web', {
        type: 'oauth',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        accountId: 'user_123',
      })

      const credentials = await CredentialStorage.get('openai-web')
      expect(credentials).toHaveLength(1)
      expect(credentials[0]?.type).toBe('oauth')
      if (credentials[0]?.type === 'oauth') {
        expect(credentials[0].accessToken).toBe('test-access-token')
        expect(credentials[0].accountId).toBe('user_123')
      }
    })

    it('should remove openai-web credential on logout', async () => {
      await CredentialStorage.add('openai-web', {
        type: 'oauth',
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
      })

      await CredentialStorage.remove('openai-web')
      const credentials = await CredentialStorage.get('openai-web')
      expect(credentials).toEqual([])
    })
  })
})
