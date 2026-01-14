import { AuthProviderRegistry, prepareGeminiCliRequest, TokenRefresh } from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import {
  getOpencodeZenEndpoint,
  prepareAntigravityRequest,
  prepareOpenAIWebRequest,
  resolveOpencodeZenProtocol,
} from '../../providers'
import { buildUpstreamHeaders, getCountTokensEndpoint, getDefaultEndpoint } from '../../upstream'
import { accountRotationManager } from '../account-rotation'
import { AllCooldownError } from '../error-utils'
import type { RetryState } from '../request-handler'
import type { ProxyOptions } from '../types'
import type { UpstreamRequest } from '../upstream-request-builder'

export interface ProviderContextResult {
  endpoint?: string
  headers: Record<string, string>
  projectId?: string
  providerInfo: UpstreamRequest['providerInfo']
  updatedRetryState: RetryState
}

export async function resolveSpecialProviderContext(
  provider: ProviderName,
  model: string,
  retryState: RetryState,
  reqId: string,
  streaming: boolean
): Promise<ProviderContextResult | null> {
  if (provider === 'openai-web') {
    const openaiWebContext = await prepareOpenAIWebRequest({
      model: model || '',
      accountIndex: retryState.accountIndex,
      reqId,
    })

    if (openaiWebContext) {
      retryState.accountIndex = openaiWebContext.accountIndex
      return {
        endpoint: openaiWebContext.endpoint,
        headers: openaiWebContext.headers,
        providerInfo: { openaiWeb: { endpoint: openaiWebContext.endpoint } },
        updatedRetryState: retryState,
      }
    } else {
      throw new AllCooldownError('No credentials available for OpenAI Web', provider, model)
    }
  }

  if (provider === 'gemini-cli') {
    const antigravityContext = await prepareAntigravityRequest({
      model: model || '',
      accountIndex: retryState.accountIndex,
      overrideProjectId: retryState.overrideProjectId,
      streaming,
      reqId,
      provider,
    })

    if (antigravityContext) {
      retryState.accountIndex = antigravityContext.accountIndex
      const geminiCliContext = await prepareGeminiCliRequest({
        model: model || '',
        accountIndex: antigravityContext.accountIndex,
        endpointIndex: retryState.antigravityEndpointIndex,
        streaming,
      })

      if (geminiCliContext) {
        return {
          endpoint: geminiCliContext.endpoint,
          headers: geminiCliContext.headers,
          projectId: antigravityContext.projectId,
          providerInfo: {
            geminiCli: {
              endpoint: geminiCliContext.endpoint,
              account: antigravityContext.account,
            },
          },
          updatedRetryState: retryState,
        }
      } else {
        throw new Error('Failed to prepare Gemini CLI context')
      }
    } else {
      throw new AllCooldownError('No credentials available for Gemini CLI', provider, model)
    }
  }

  return null
}

export async function resolveGenericContext(
  provider: ProviderName,
  model: string,
  retryState: RetryState,
  options: ProxyOptions,
  mode: 'streaming' | 'non-streaming' | 'count_tokens'
): Promise<ProviderContextResult> {
  let endpoint: string | undefined
  let headers: Record<string, string> = {}

  if (provider === 'opencode-zen') {
    const protocol = resolveOpencodeZenProtocol(model || '')
    if (protocol) {
      endpoint =
        protocol === 'gemini'
          ? getOpencodeZenEndpoint(protocol, model || '')
          : getOpencodeZenEndpoint(protocol)
    }
  }

  // Generic Auth Provider fallback
  if (!endpoint) {
    const currentAuthProvider = AuthProviderRegistry.get(provider)

    // If we haven't handled auth yet (not special provider) and no API key
    if (
      currentAuthProvider &&
      !options.apiKey &&
      provider !== 'antigravity' &&
      provider !== 'openai-web'
    ) {
      try {
        const creds = await TokenRefresh.ensureFresh(provider)
        retryState.accountIndex = accountRotationManager.getNextAvailable(
          provider,
          model || '',
          creds || []
        )
        const credential = creds?.[retryState.accountIndex]
        if (!credential)
          throw new AllCooldownError('No credentials available (all rate-limited)', provider, model)

        endpoint = currentAuthProvider.getEndpoint(options.targetModel || model || '', {
          streaming: mode === 'streaming',
        })
        headers = await currentAuthProvider.getHeaders(credential, {
          model: options.targetModel || model,
        })
      } catch {
        if (!endpoint) endpoint = ''
        throw new AllCooldownError(`No credentials for ${provider}`, provider, model)
      }
    } else {
      // Standard endpoint/header
      if (mode === 'count_tokens') {
        endpoint = getCountTokensEndpoint(provider) || ''
      } else {
        endpoint =
          getDefaultEndpoint(provider, {
            streaming: mode === 'streaming',
            model,
          }) || ''
      }
      headers = buildUpstreamHeaders(provider, options.apiKey, {
        fromProtocol: model?.includes('claude') ? 'anthropic' : undefined,
      })
    }
  }

  if (!endpoint) {
    throw new Error(`Could not resolve endpoint for ${provider}`)
  }

  return {
    endpoint,
    headers,
    providerInfo: {},
    updatedRetryState: retryState,
  }
}
