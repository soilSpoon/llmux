import { describe, it, expect, beforeEach } from 'bun:test'
import { AccountRotationManager } from '../account-rotation'
import type { OAuthCredential } from '@llmux/auth'

describe('AccountRotationManager', () => {
  let manager: AccountRotationManager

  beforeEach(() => {
    manager = new AccountRotationManager()
  })

  describe('getAccountId', () => {
    it('should use accountId if present', () => {
      const cred: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600,
        accountId: 'real-account-id',
        email: 'test@example.com'
      }
      // Accessing private method for testing purpose
      const id = (manager as any).getAccountId(cred)
      expect(id).toBe('real-account-id')
    })

    it('should fallback to email if accountId is missing', () => {
      const cred: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600,
        email: 'user@example.com' // accountId is missing
      }
      const id = (manager as any).getAccountId(cred)
      expect(id).toBe('user@example.com')
    })

    it('should distinguish between different accounts with different emails when accountId is missing', () => {
      const cred1: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token1',
        refreshToken: 'refresh1',
        expiresAt: Date.now() + 3600,
        email: 'user1@example.com'
      }
      const cred2: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: Date.now() + 3600,
        email: 'user2@example.com'
      }
      
      const id1 = (manager as any).getAccountId(cred1)
      const id2 = (manager as any).getAccountId(cred2)
      
      expect(id1).not.toBe(id2)
      expect(id1).toBe('user1@example.com')
      expect(id2).toBe('user2@example.com')
    })

    it('should fallback to unknown-oauth if both are missing', () => {
      const cred: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600,
      } as any
      const id = (manager as any).getAccountId(cred)
      expect(id).toBe('unknown-oauth')
    })
  })
})
