import { createLogger } from '@llmux/core'
import type { AmpModelMapping } from '../config'
import { detectFormat } from '../middleware/format'
import type { ModelLookup } from '../models/lookup'
import type { RouteParams } from '../router'
import type { UpstreamProxy } from '../upstream/proxy'
import { applyModelMapping } from './model-mapping'
import { handleStreamingProxy } from './streaming'

export type RouteHandler = (request: Request, params?: RouteParams) => Promise<Response>

const logger = createLogger({ service: 'fallback-handler' })

export type ProviderChecker = (model: string) => boolean

export interface PathParams {
  action?: string
  path?: string
}

export async function extractModel(
  request: Request,
  pathParams?: PathParams
): Promise<string | null> {
  if (pathParams?.action) {
    const parts = pathParams.action.split(':')
    if (parts.length > 0 && parts[0]) {
      return parts[0]
    }
  }

  if (pathParams?.path) {
    const modelsIdx = pathParams.path.indexOf('models/')
    if (modelsIdx >= 0) {
      const modelPart = pathParams.path.slice(modelsIdx + 7)
      const colonIdx = modelPart.indexOf(':')
      if (colonIdx > 0) {
        return modelPart.slice(0, colonIdx)
      }
    }
  }

  try {
    const clonedRequest = request.clone()
    const text = await clonedRequest.text()
    if (!text) {
      return null
    }

    const body = JSON.parse(text)
    if (typeof body.model === 'string') {
      return body.model
    }
  } catch {
    return null
  }

  return null
}

export class FallbackHandler {
  private getProxy: () => UpstreamProxy | null
  private hasLocalProvider: ProviderChecker
  private modelMappings?: AmpModelMapping[]
  private modelLookup?: ModelLookup

  constructor(
    getProxy: () => UpstreamProxy | null,
    providerChecker?: ProviderChecker,
    modelMappings?: AmpModelMapping[],
    modelLookup?: ModelLookup
  ) {
    this.getProxy = getProxy
    this.hasLocalProvider = providerChecker ?? (() => false)
    this.modelMappings = modelMappings
    this.modelLookup = modelLookup
  }

  wrap(handler: RouteHandler): RouteHandler {
    return async (request: Request, params?: RouteParams): Promise<Response> => {
      const bodyBytes = await request.arrayBuffer()

      // Log original AMP request for debugging
      try {
        const bodyText = new TextDecoder().decode(bodyBytes)
        const bodyJson = JSON.parse(bodyText)
        logger.debug(
          {
            url: request.url,
            model: bodyJson.model,
            messageCount: bodyJson.messages?.length || 0,
            bodyPreview: bodyText.slice(0, 500),
          },
          'Original AMP request received'
        )
      } catch {
        logger.debug({ url: request.url }, 'Original AMP request received (non-JSON body)')
      }

      const bodyForExtraction = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyBytes,
      })

      const pathParams: PathParams = {
        action: params?.action,
        path: params?.path,
      }
      let model = await extractModel(bodyForExtraction, pathParams)

      if (!model) {
        const restoredRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBytes,
        })
        return handler(restoredRequest, params)
      }

      // Apply model mapping
      const originalModel = model
      const mappedModel = applyModelMapping(originalModel, this.modelMappings)
      let finalBodyBytes: ArrayBuffer | Uint8Array = bodyBytes

      if (mappedModel !== originalModel) {
        logger.info(
          {
            originalModel,
            mappedModel,
            mappings:
              this.modelMappings?.map(
                (m) => `${m.from}->${Array.isArray(m.to) ? m.to.join(',') : m.to}`
              ) || [],
          },
          'Fallback model mapping applied'
        )
        model = mappedModel

        // If mapped, we need to rewrite the body for the proxy
        try {
          const text = new TextDecoder().decode(bodyBytes)
          const json = JSON.parse(text)
          if (json.model) {
            json.model = mappedModel
            finalBodyBytes = new TextEncoder().encode(JSON.stringify(json))
          }
        } catch (e) {
          logger.warn(
            { error: e instanceof Error ? e.message : String(e) },
            'Failed to rewrite body with mapped model'
          )
        }
      } else {
        // Also log implicit non-mapping if desired, but user specifically asked for mapping visibility.
        // We can stick to the pattern used in streaming.ts if we want consistency, or just log when fallback happens.
        // Let's log available mappings if no mapping found, to help debugging
        logger.debug({ originalModel }, 'No fallback model mapping found')
      }

      // Check if model is available via ModelLookup (from /models endpoint data)
      let hasProvider = this.hasLocalProvider(model)
      let detectedProvider: string | undefined

      if (!hasProvider && this.modelLookup) {
        detectedProvider = await this.modelLookup.getProviderForModel(model)
        if (detectedProvider) {
          hasProvider = true
          logger.info(
            { model, provider: detectedProvider },
            'Model found in authenticated provider via ModelLookup'
          )
        }
      }

      if (hasProvider) {
        // Use updated body if mapped
        const restoredRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: finalBodyBytes,
        })

        // If we detected a provider via ModelLookup, call streaming handler directly
        // since the AMP dispatcher may not have a registered handler for this provider
        if (detectedProvider) {
          // Parse body to detect source format
          let sourceFormat: 'openai' | 'anthropic' | 'gemini' = 'anthropic'
          try {
            const text = new TextDecoder().decode(finalBodyBytes)
            const json = JSON.parse(text)
            const detected = detectFormat(json)
            // Only use detected format if it's one of the standard formats
            if (detected === 'openai' || detected === 'anthropic' || detected === 'gemini') {
              sourceFormat = detected
            }
          } catch {
            // Default to anthropic if parsing fails
          }

          logger.info(
            { model, provider: detectedProvider, sourceFormat },
            'Routing to streaming handler for detected provider'
          )

          return handleStreamingProxy(restoredRequest, {
            sourceFormat,
            targetProvider: detectedProvider,
            targetModel: model,
            modelMappings: this.modelMappings,
          })
        }

        // If hasLocalProvider returned true (not via ModelLookup), use original handler
        return handler(restoredRequest, params)
      }

      const proxy = this.getProxy()
      if (proxy) {
        logger.info(
          { model, proxyUrl: proxy.targetUrl },
          'No local provider found for model, falling back to AMP proxy'
        )
        const proxyRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          // Use finalBodyBytes to ensure mapped model is sent to upstream
          body: finalBodyBytes,
        })
        return proxy.proxyRequest(proxyRequest)
      }

      return new Response(
        JSON.stringify({
          error: `No provider available for model: ${model}`,
          model,
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }
}
