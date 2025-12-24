import { describe, expect, it } from 'bun:test'
import { parse, transform } from '../../../src/providers/antigravity/request'
import type { UnifiedRequest } from '../../../src/types/unified'
import type { AntigravityRequest } from '../../../src/providers/antigravity/types'
import { createUnifiedRequest, createUnifiedMessage, createUnifiedTool } from '../_utils/fixtures'

describe('Antigravity Request Transformations', () => {
  describe('parse()', () => {
    describe('basic request parsing', () => {
      it('should parse a simple text request', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].role).toBe('user')
        expect(result.messages[0].parts[0].type).toBe('text')
        expect(result.messages[0].parts[0].text).toBe('Hello')
      })

      it('should parse multi-turn conversation', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [
              { role: 'user', parts: [{ text: 'Hello' }] },
              { role: 'model', parts: [{ text: 'Hi there!' }] },
              { role: 'user', parts: [{ text: 'How are you?' }] },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages).toHaveLength(3)
        expect(result.messages[0].role).toBe('user')
        expect(result.messages[1].role).toBe('assistant')
        expect(result.messages[2].role).toBe('user')
      })

      it('should convert model role to assistant', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [
              { role: 'model', parts: [{ text: 'Hello from model' }] },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages[0].role).toBe('assistant')
      })
    })

    describe('system instruction parsing', () => {
      it('should parse systemInstruction into system field', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            systemInstruction: {
              parts: [{ text: 'You are a helpful assistant.' }],
            },
          },
        }

        const result = parse(antigravityRequest)

        expect(result.system).toBe('You are a helpful assistant.')
      })

      it('should concatenate multiple system parts', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            systemInstruction: {
              parts: [
                { text: 'You are helpful.' },
                { text: 'Be concise.' },
              ],
            },
          },
        }

        const result = parse(antigravityRequest)

        expect(result.system).toBe('You are helpful.\nBe concise.')
      })
    })

    describe('generation config parsing', () => {
      it('should parse generationConfig', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            generationConfig: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              maxOutputTokens: 1000,
              stopSequences: ['END'],
            },
          },
        }

        const result = parse(antigravityRequest)

        expect(result.config?.temperature).toBe(0.7)
        expect(result.config?.topP).toBe(0.9)
        expect(result.config?.topK).toBe(40)
        expect(result.config?.maxTokens).toBe(1000)
        expect(result.config?.stopSequences).toEqual(['END'])
      })
    })

    describe('thinking config parsing', () => {
      it('should parse thinkingConfig with camelCase', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.5-pro',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            generationConfig: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: 8192,
              },
            },
          },
        }

        const result = parse(antigravityRequest)

        expect(result.thinking?.enabled).toBe(true)
        expect(result.thinking?.budget).toBe(8192)
        expect(result.thinking?.includeThoughts).toBe(true)
      })

      it('should parse thinkingConfig with snake_case (Claude style)', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'claude-sonnet-4-5-thinking',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            generationConfig: {
              thinkingConfig: {
                include_thoughts: true,
                thinking_budget: 16384,
              },
            },
          },
        }

        const result = parse(antigravityRequest)

        expect(result.thinking?.enabled).toBe(true)
        expect(result.thinking?.budget).toBe(16384)
        expect(result.thinking?.includeThoughts).toBe(true)
      })
    })

    describe('tools parsing', () => {
      it('should parse functionDeclarations to tools', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            tools: [
              {
                functionDeclarations: [
                  {
                    name: 'get_weather',
                    description: 'Get weather information',
                    parameters: {
                      type: 'OBJECT',
                      properties: {
                        location: { type: 'STRING', description: 'City name' },
                      },
                      required: ['location'],
                    },
                  },
                ],
              },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.tools).toHaveLength(1)
        expect(result.tools![0].name).toBe('get_weather')
        expect(result.tools![0].description).toBe('Get weather information')
        expect(result.tools![0].parameters.type).toBe('object')
      })
    })

    describe('function call/response parsing', () => {
      it('should parse functionCall parts', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [
              {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'NYC' },
                      id: 'call-123',
                    },
                  },
                ],
              },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages[0].parts[0].type).toBe('tool_call')
        expect(result.messages[0].parts[0].toolCall?.name).toBe('get_weather')
        expect(result.messages[0].parts[0].toolCall?.arguments).toEqual({ location: 'NYC' })
        expect(result.messages[0].parts[0].toolCall?.id).toBe('call-123')
      })

      it('should parse functionResponse parts', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    functionResponse: {
                      name: 'get_weather',
                      response: { temp: 72 },
                      id: 'call-123',
                    },
                  },
                ],
              },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages[0].parts[0].type).toBe('tool_result')
        expect(result.messages[0].parts[0].toolResult?.toolCallId).toBe('call-123')
        expect(result.messages[0].parts[0].toolResult?.content).toBe('{"temp":72}')
      })
    })

    describe('thinking blocks parsing', () => {
      it('should parse thought parts with signatures', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'claude-sonnet-4-5-thinking',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [
              {
                role: 'model',
                parts: [
                  {
                    thought: true,
                    text: 'Let me think about this...',
                    thoughtSignature: 'sig123',
                  },
                  { text: 'Here is my answer.' },
                ],
              },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages[0].parts[0].type).toBe('thinking')
        expect(result.messages[0].parts[0].thinking?.text).toBe('Let me think about this...')
        expect(result.messages[0].parts[0].thinking?.signature).toBe('sig123')
        expect(result.messages[0].parts[1].type).toBe('text')
      })
    })

    describe('metadata extraction', () => {
      it('should extract sessionId into metadata', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            sessionId: 'session-abc123',
          },
        }

        const result = parse(antigravityRequest)

        expect(result.metadata?.sessionId).toBe('session-abc123')
      })

      it('should extract outer model into metadata', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'claude-sonnet-4-5-thinking',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.metadata?.model).toBe('claude-sonnet-4-5-thinking')
      })

      it('should extract project and requestId into metadata', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'rising-fact-p41fc',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-550e8400',
          request: {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.metadata?.project).toBe('rising-fact-p41fc')
        expect(result.metadata?.requestId).toBe('agent-550e8400')
      })
    })

    describe('image parsing', () => {
      it('should parse inlineData as image', () => {
        const antigravityRequest: AntigravityRequest = {
          project: 'test-project',
          model: 'gemini-2.0-flash',
          userAgent: 'antigravity',
          requestId: 'agent-123',
          request: {
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: 'image/png', data: 'base64data' } },
                  { text: 'What is in this image?' },
                ],
              },
            ],
          },
        }

        const result = parse(antigravityRequest)

        expect(result.messages[0].parts[0].type).toBe('image')
        expect(result.messages[0].parts[0].image?.mimeType).toBe('image/png')
        expect(result.messages[0].parts[0].image?.data).toBe('base64data')
      })
    })
  })

  describe('transform()', () => {
    describe('basic request transformation', () => {
      it('should transform a simple text request', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.project).toBeDefined()
        expect(result.model).toBeDefined()
        expect(result.userAgent).toBe('antigravity')
        expect(result.requestId).toMatch(/^agent-/)
        expect(result.request.contents).toHaveLength(1)
        expect(result.request.contents[0].role).toBe('user')
        expect(result.request.contents[0].parts[0].text).toBe('Hello')
      })

      it('should transform multi-turn conversation', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [
            createUnifiedMessage('user', 'Hello'),
            createUnifiedMessage('assistant', 'Hi there!'),
            createUnifiedMessage('user', 'How are you?'),
          ],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.contents).toHaveLength(3)
        expect(result.request.contents[0].role).toBe('user')
        expect(result.request.contents[1].role).toBe('model')
        expect(result.request.contents[2].role).toBe('user')
      })

      it('should convert assistant role to model', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('assistant', 'Hello from assistant')],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.contents[0].role).toBe('model')
      })
    })

    describe('system instruction transformation', () => {
      it('should transform system to systemInstruction', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          system: 'You are a helpful assistant.',
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.systemInstruction).toBeDefined()
        expect(result.request.systemInstruction?.parts).toHaveLength(1)
        expect(result.request.systemInstruction?.parts[0].text).toBe('You are a helpful assistant.')
      })
    })

    describe('generation config transformation', () => {
      it('should transform config to generationConfig', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          config: {
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxTokens: 1000,
            stopSequences: ['END'],
          },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.generationConfig?.temperature).toBe(0.7)
        expect(result.request.generationConfig?.topP).toBe(0.9)
        expect(result.request.generationConfig?.topK).toBe(40)
        expect(result.request.generationConfig?.maxOutputTokens).toBe(1000)
        expect(result.request.generationConfig?.stopSequences).toEqual(['END'])
      })
    })

    describe('thinking config transformation', () => {
      it('should transform thinking config for Gemini models', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          thinking: {
            enabled: true,
            budget: 8192,
            includeThoughts: true,
          },
          metadata: { model: 'gemini-2.5-pro' },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.generationConfig?.thinkingConfig?.includeThoughts).toBe(true)
        expect(result.request.generationConfig?.thinkingConfig?.thinkingBudget).toBe(8192)
      })

      it('should use snake_case for Claude thinking models', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          thinking: {
            enabled: true,
            budget: 16384,
            includeThoughts: true,
          },
          metadata: { model: 'claude-sonnet-4-5-thinking' },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.generationConfig?.thinkingConfig?.include_thoughts).toBe(true)
        expect(result.request.generationConfig?.thinkingConfig?.thinking_budget).toBe(16384)
      })

      it('should set minimum maxOutputTokens for Claude thinking models', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          thinking: {
            enabled: true,
            budget: 16384,
          },
          config: {
            maxTokens: 1000,
          },
          metadata: { model: 'claude-sonnet-4-5-thinking' },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.generationConfig?.maxOutputTokens).toBeGreaterThanOrEqual(64000)
      })
    })

    describe('tools transformation', () => {
      it('should transform tools to functionDeclarations', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          tools: [
            createUnifiedTool('get_weather', 'Get weather info', {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            }),
          ],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.tools).toHaveLength(1)
        expect(result.request.tools![0].functionDeclarations).toHaveLength(1)
        expect(result.request.tools![0].functionDeclarations![0].name).toBe('get_weather')
      })

      it('should enforce VALIDATED mode in toolConfig', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          tools: [createUnifiedTool('test_tool', 'A test tool')],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.toolConfig?.functionCallingConfig?.mode).toBe('VALIDATED')
      })
    })

    describe('tool call/result transformation', () => {
      it('should transform tool_call to functionCall', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool_call',
                  toolCall: {
                    id: 'call-123',
                    name: 'get_weather',
                    arguments: { location: 'NYC' },
                  },
                },
              ],
            },
          ],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.contents[0].parts[0].functionCall?.name).toBe('get_weather')
        expect(result.request.contents[0].parts[0].functionCall?.args).toEqual({ location: 'NYC' })
        expect(result.request.contents[0].parts[0].functionCall?.id).toBe('call-123')
      })

      it('should transform tool_result to functionResponse', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [
            {
              role: 'tool',
              parts: [
                {
                  type: 'tool_result',
                  toolResult: {
                    toolCallId: 'call-123',
                    content: '{"temp": 72}',
                  },
                },
              ],
            },
          ],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.contents[0].parts[0].functionResponse?.name).toBeDefined()
        expect(result.request.contents[0].parts[0].functionResponse?.id).toBe('call-123')
      })
    })

    describe('thinking blocks transformation', () => {
      it('should transform thinking parts with signatures', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'thinking',
                  thinking: {
                    text: 'Let me think...',
                    signature: 'sig123',
                  },
                },
                { type: 'text', text: 'Here is my answer.' },
              ],
            },
          ],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.contents[0].parts[0].thought).toBe(true)
        expect(result.request.contents[0].parts[0].text).toBe('Let me think...')
        expect(result.request.contents[0].parts[0].thoughtSignature).toBe('sig123')
      })
    })

    describe('metadata transformation', () => {
      it('should use sessionId from metadata', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          metadata: { sessionId: 'session-abc123' },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.sessionId).toBe('session-abc123')
      })

      it('should use model from metadata', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          metadata: { model: 'claude-sonnet-4-5' },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.model).toBe('claude-sonnet-4-5')
      })

      it('should use project from metadata', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
          metadata: { project: 'my-project' },
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.project).toBe('my-project')
      })

      it('should default model to gemini-2.0-flash', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.model).toBe('gemini-2.0-flash')
      })

      it('should default project to llmux', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [createUnifiedMessage('user', 'Hello')],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.project).toBe('llmux')
      })
    })

    describe('image transformation', () => {
      it('should transform image to inlineData', () => {
        const unifiedRequest = createUnifiedRequest({
          messages: [
            {
              role: 'user',
              parts: [
                { type: 'image', image: { mimeType: 'image/png', data: 'base64data' } },
                { type: 'text', text: 'What is in this image?' },
              ],
            },
          ],
        })

        const result = transform(unifiedRequest) as AntigravityRequest

        expect(result.request.contents[0].parts[0].inlineData?.mimeType).toBe('image/png')
        expect(result.request.contents[0].parts[0].inlineData?.data).toBe('base64data')
      })
    })
  })

  describe('round-trip', () => {
    it('should preserve text content through round-trip', () => {
      const unifiedRequest = createUnifiedRequest({
        messages: [
          createUnifiedMessage('user', 'Hello'),
          createUnifiedMessage('assistant', 'Hi there!'),
        ],
        system: 'Be helpful',
        config: { temperature: 0.7, maxTokens: 1000 },
      })

      const antigravityRequest = transform(unifiedRequest)
      const parsedBack = parse(antigravityRequest as AntigravityRequest)

      expect(parsedBack.messages[0].parts[0].text).toBe('Hello')
      expect(parsedBack.messages[1].parts[0].text).toBe('Hi there!')
      expect(parsedBack.system).toBe('Be helpful')
      expect(parsedBack.config?.temperature).toBe(0.7)
      expect(parsedBack.config?.maxTokens).toBe(1000)
    })
  })
})
