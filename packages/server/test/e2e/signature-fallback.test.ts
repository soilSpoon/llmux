/**
 * Signature Fallback E2E Integration Tests
 *
 * Phase 5 테스트: 전체 signature 흐름 검증
 *
 * 테스트 시나리오:
 * 1. 전체 request → response → next request 흐름 (mocked Antigravity API)
 * 2. projectId 변경 시 signature 제거 확인
 * 3. 같은 projectId면 signature 유지 확인
 * 4. Claude → Gemini fallback 시나리오 (다른 모델 가족)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import '../setup'
import { SignatureStore } from '../../src/stores/signature-store'
import { validateAndStripSignatures } from '../../src/handlers/signature-request'
import { saveSignaturesFromResponse, extractSignaturesFromSSE } from '../../src/handlers/signature-response'

describe('Signature Fallback E2E Tests', () => {
  let signatureStore: SignatureStore

  beforeEach(() => {
    signatureStore = new SignatureStore()
  })

  afterEach(() => {
    signatureStore.close()
  })

  describe('Full Request → Response → Next Request Flow', () => {
    it('should save signature from response and validate in next request (same projectId)', () => {
      const projectId = 'project-A'
      const signature = 'ErADCq0DAXLI2nx-test-signature-123'

      // Step 1: Response에서 signature 저장 (첫 번째 요청 완료 후)
      const sseData = `data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Let me think...","thoughtSignature":"${signature}"}]}}]}\n\n`

      const savedCount = saveSignaturesFromResponse(
        sseData,
        {
          projectId,
          provider: 'antigravity',
          endpoint: 'daily',
          account: 'test@example.com',
        },
        signatureStore
      )

      expect(savedCount).toBe(1)

      // Step 2: 다음 요청에서 같은 projectId로 signature 검증
      const nextRequestContents = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Let me think...',
              thoughtSignature: signature,
            },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Continue please' }],
        },
      ]

      const result = validateAndStripSignatures({
        contents: nextRequestContents,
        targetProjectId: projectId,
        signatureStore,
      })

      // 같은 projectId이므로 signature 유지
      expect(result.strippedCount).toBe(0)
      const parts = result.contents?.[0]?.parts
      expect(parts?.[0]?.thoughtSignature).toBe(signature)
    })

    it('should strip signature when projectId changes (different project fallback)', () => {
      const projectA = 'project-A'
      const projectB = 'project-B'
      const signature = 'ErADCq0DAXLI2nx-cross-project-signature'

      // Step 1: Project A에서 signature 생성
      signatureStore.saveSignature({
        signature,
        projectId: projectA,
        provider: 'antigravity',
        endpoint: 'daily',
        account: 'account-a@example.com',
      })

      // Step 2: Project B로 fallback 시 signature 검증
      const requestContents = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Previous thinking...',
              thoughtSignature: signature,
            },
            {
              text: 'Previous response',
            },
          ],
        },
      ]

      const result = validateAndStripSignatures({
        contents: requestContents,
        targetProjectId: projectB, // 다른 프로젝트!
        signatureStore,
      })

      // 다른 projectId이므로 signature 제거
      expect(result.strippedCount).toBe(1)
      const parts = result.contents?.[0]?.parts
      expect(parts?.[0]?.thoughtSignature).toBeUndefined()
      // thought와 text는 유지
      expect(parts?.[0]?.thought).toBe(true)
      expect(parts?.[0]?.text).toBe('Previous thinking...')
    })

    it('should strip unknown signatures (not in store)', () => {
      const projectId = 'project-X'
      const unknownSignature = 'unknown-signature-never-saved'

      const requestContents = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Some thinking',
              thoughtSignature: unknownSignature,
            },
          ],
        },
      ]

      const result = validateAndStripSignatures({
        contents: requestContents,
        targetProjectId: projectId,
        signatureStore,
      })

      // 미등록 signature는 제거
      expect(result.strippedCount).toBe(1)
      const parts = result.contents?.[0]?.parts
      expect(parts?.[0]?.thoughtSignature).toBeUndefined()
    })
  })

  describe('Claude → Gemini Fallback Scenario', () => {
    it('should handle Anthropic format messages with signature stripping', () => {
      const claudeProjectId = 'claude-project'
      const geminiProjectId = 'gemini-project'
      const claudeSignature = 'claude-thinking-signature-abc123'

      // Claude에서 생성된 signature 저장
      signatureStore.saveSignature({
        signature: claudeSignature,
        projectId: claudeProjectId,
        provider: 'antigravity',
        endpoint: 'prod',
        account: 'claude-account@example.com',
      })

      // Anthropic 형식 메시지 (Claude 응답 히스토리)
      const anthropicMessages = [
        { role: 'user', content: 'What is 2+2?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'I need to calculate 2+2 which equals 4',
              signature: claudeSignature,
            },
            {
              type: 'text',
              text: 'The answer is 4',
            },
          ],
        },
        { role: 'user', content: 'Can you verify that?' },
      ]

      // Gemini 프로젝트로 fallback 시
      const result = validateAndStripSignatures({
        messages: anthropicMessages,
        targetProjectId: geminiProjectId, // 다른 프로젝트
        signatureStore,
      })

      expect(result.strippedCount).toBe(1)

      const assistantContent = result.messages?.[1]?.content as Array<{
        type?: string
        thinking?: string
        signature?: string
        text?: string
      }> | undefined
      expect(assistantContent?.[0]?.signature).toBeUndefined()
      expect(assistantContent?.[0]?.thinking).toBe('I need to calculate 2+2 which equals 4')
      expect(assistantContent?.[1]?.text).toBe('The answer is 4')
    })

    it('should preserve signature when fallback to same project (different endpoint)', () => {
      const projectId = 'shared-project'
      const signature = 'shared-project-signature'

      // Daily 엔드포인트에서 signature 저장
      signatureStore.saveSignature({
        signature,
        projectId,
        provider: 'antigravity',
        endpoint: 'daily',
        account: 'daily-account@example.com',
      })

      // Prod 엔드포인트로 fallback (같은 프로젝트)
      const requestContents = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Thinking content',
              thoughtSignature: signature,
            },
          ],
        },
      ]

      const result = validateAndStripSignatures({
        contents: requestContents,
        targetProjectId: projectId, // 같은 프로젝트
        signatureStore,
      })

      // 같은 프로젝트이므로 signature 유지
      expect(result.strippedCount).toBe(0)
      const parts = result.contents?.[0]?.parts
      expect(parts?.[0]?.thoughtSignature).toBe(signature)
    })
  })

  describe('SSE Response Signature Extraction', () => {
    it('should extract thoughtSignature from Gemini/Antigravity SSE response', () => {
      const sseData = `data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking...","thoughtSignature":"gemini-sig-123"}]}}]}\n\n`

      const signatures = extractSignaturesFromSSE(sseData)
      expect(signatures).toEqual(['gemini-sig-123'])
    })

    it('should extract signature from Anthropic signature_delta event', () => {
      const sseData = `data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"anthropic-sig-456"}}\n\n`

      const signatures = extractSignaturesFromSSE(sseData)
      expect(signatures).toEqual(['anthropic-sig-456'])
    })

    it('should extract signature from content_block', () => {
      const sseData = `data: {"type":"content_block_start","content_block":{"type":"thinking","signature":"block-sig-789"}}\n\n`

      const signatures = extractSignaturesFromSSE(sseData)
      expect(signatures).toEqual(['block-sig-789'])
    })

    it('should deduplicate multiple occurrences of same signature', () => {
      const sseData = `data: {"parts":[{"thoughtSignature":"dup-sig"},{"thoughtSignature":"dup-sig"}]}\n\n`

      const signatures = extractSignaturesFromSSE(sseData)
      expect(signatures).toEqual(['dup-sig'])
    })

    it('should return empty array for [DONE] event', () => {
      const signatures = extractSignaturesFromSSE('data: [DONE]\n\n')
      expect(signatures).toEqual([])
    })
  })

  describe('Multiple Signatures in Single Request', () => {
    it('should strip only invalid signatures, keeping valid ones', () => {
      const validProjectId = 'valid-project'
      const invalidProjectId = 'invalid-project'
      const validSig = 'valid-signature'
      const invalidSig = 'invalid-signature'

      // 유효한 signature 저장
      signatureStore.saveSignature({
        signature: validSig,
        projectId: validProjectId,
        provider: 'antigravity',
        endpoint: 'daily',
        account: 'test@example.com',
      })

      // 무효한 signature 저장 (다른 프로젝트)
      signatureStore.saveSignature({
        signature: invalidSig,
        projectId: invalidProjectId,
        provider: 'antigravity',
        endpoint: 'daily',
        account: 'test@example.com',
      })

      const requestContents = [
        {
          role: 'model',
          parts: [
            { thought: true, text: 'Valid thinking', thoughtSignature: validSig },
          ],
        },
        {
          role: 'model',
          parts: [
            { thought: true, text: 'Invalid thinking', thoughtSignature: invalidSig },
          ],
        },
      ]

      const result = validateAndStripSignatures({
        contents: requestContents,
        targetProjectId: validProjectId,
        signatureStore,
      })

      // 하나만 제거 (invalidSig)
      expect(result.strippedCount).toBe(1)
      const parts0 = result.contents?.[0]?.parts
      const parts1 = result.contents?.[1]?.parts
      expect(parts0?.[0]?.thoughtSignature).toBe(validSig)
      expect(parts1?.[0]?.thoughtSignature).toBeUndefined()
    })
  })

  describe('Snake Case Support', () => {
    it('should handle thought_signature (snake_case) in contents', () => {
      const projectId = 'snake-case-project'
      const signature = 'snake-case-signature'

      signatureStore.saveSignature({
        signature,
        projectId: 'different-project', // 다른 프로젝트
        provider: 'antigravity',
        endpoint: 'daily',
        account: 'test@example.com',
      })

      const requestContents = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Thinking with snake_case',
              thought_signature: signature, // snake_case
            },
          ],
        },
      ]

      const result = validateAndStripSignatures({
        contents: requestContents,
        targetProjectId: projectId,
        signatureStore,
      })

      expect(result.strippedCount).toBe(1)
      const parts = result.contents?.[0]?.parts
      expect(parts?.[0]?.thought_signature).toBeUndefined()
    })
  })
})
