import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { CredentialStorage } from '@llmux/auth'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
      await CredentialStorage.set('test-provider', {
        type: 'api',
        key: 'test-key',
      })

      const credentials = await CredentialStorage.all()
      expect(Object.keys(credentials).length).toBe(1)
      expect(credentials['test-provider']).toEqual({
        type: 'api',
        key: 'test-key',
      })
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
      await CredentialStorage.set('my-provider', {
        type: 'api',
        key: 'my-api-key',
      })

      const credential = await CredentialStorage.get('my-provider')
      expect(credential).toEqual({
        type: 'api',
        key: 'my-api-key',
      })
    })

    it('should remove credential on logout', async () => {
      await CredentialStorage.set('my-provider', {
        type: 'api',
        key: 'my-api-key',
      })

      await CredentialStorage.remove('my-provider')
      const credential = await CredentialStorage.get('my-provider')
      expect(credential).toBeUndefined()
    })
  })
})
