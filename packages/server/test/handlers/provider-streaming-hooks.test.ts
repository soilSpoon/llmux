import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { extractSignaturesFromSSE, saveSignaturesFromResponse } from '../../src/handlers/signature-response'
import { SignatureStore } from '../../src/stores/signature-store'

describe('Signature Streaming Hooks (Updated for new system)', () => {
  let signatureStore: SignatureStore

  beforeEach(() => {
    signatureStore = new SignatureStore()
  })

  afterEach(() => {
    signatureStore.close()
  })

  describe('extractSignaturesFromSSE', () => {
    it('should extract signatures from SSE data', () => {
      const sseData = 'data: {"thoughtSignature": "hook_sig_123"}'
      const signatures = extractSignaturesFromSSE(sseData)
      
      expect(signatures).toContain('hook_sig_123')
      expect(signatures).toHaveLength(1)
    })

    it('should ignore events without signatures', () => {
      const sseData = 'data: {"content": "hello"}'
      const signatures = extractSignaturesFromSSE(sseData)
      
      expect(signatures).toHaveLength(0)
    })

    it('should extract multiple signatures from complex SSE data', () => {
      const sseData = `data: {"thoughtSignature": "sig1"}
data: {"content": "some content"}
data: {"thoughtSignature": "sig2"}`
      const signatures = extractSignaturesFromSSE(sseData)
      
      expect(signatures).toContain('sig1')
      expect(signatures).toContain('sig2')
      expect(signatures).toHaveLength(2)
    })
  })

  describe('saveSignaturesFromResponse', () => {
    it('should save extracted signatures to store', async () => {
      const sseData = 'data: {"thoughtSignature": "test_sig_123"}'
      const signatureContext = {
        projectId: 'test-project',
        provider: 'antigravity',
        endpoint: 'test-endpoint',
        account: 'test-account'
      }

      const count = saveSignaturesFromResponse(sseData, signatureContext, signatureStore)
      
      expect(count).toBe(1)
      
      const record = signatureStore.getRecord('test_sig_123')
      expect(record).not.toBeNull()
      expect(record?.projectId).toBe('test-project')
    })

    it('should handle multiple signatures in response', async () => {
      const sseData = `data: {"thoughtSignature": "sig1"}
data: {"thoughtSignature": "sig2"}`
      const signatureContext = {
        projectId: 'test-project',
        provider: 'antigravity',
        endpoint: 'test-endpoint',
        account: 'test-account'
      }

      const count = saveSignaturesFromResponse(sseData, signatureContext, signatureStore)
      
      expect(count).toBe(2)
      
      const record1 = signatureStore.getRecord('sig1')
      const record2 = signatureStore.getRecord('sig2')
      expect(record1).not.toBeNull()
      expect(record2).not.toBeNull()
    })
  })
})
