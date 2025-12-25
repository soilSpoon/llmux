import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { CredentialStorage } from '@llmux/auth'
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
      expect(defaultConfig.routing.defaultProvider).toBe('anthropic')
    })

    it('should get routing config', async () => {
      const routing = await ConfigLoader.get('routing')
      expect(routing.defaultProvider).toBe('anthropic')
      expect(routing.rotateOn429).toBe(true)
    })
  })
})
