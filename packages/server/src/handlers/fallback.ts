import { createLogger, isValidProviderName } from '@llmux/core'
import type { AmpModelMapping } from '../config'
import { detectFormat } from '../middleware/format'
import type { ModelLookup } from '../models/lookup'
import type { RouteParams } from '../router'
import type { Router } from '../routing'
import type { UpstreamProxy } from '../upstream/proxy'
import { applyModelMappingV2 } from './model-mapping'
import { handleProxy } from './proxy'
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
      // Handle Google/Vertex model formats like "gemini-3-pro-preview" or "publishers/google/models/gemini-3-pro-preview"
      const modelPart = parts[0]
      // Check if it's a full resource path
      if (modelPart.includes('/models/')) {
        const modelsIdx = modelPart.lastIndexOf('/models/')
        if (modelsIdx >= 0) {
          return modelPart.slice(modelsIdx + 8)
        }
      }
      return modelPart
    }
  }

  if (pathParams?.path) {
    const modelsIdx = pathParams.path.lastIndexOf('models/')
    if (modelsIdx >= 0) {
      const modelPart = pathParams.path.slice(modelsIdx + 7)
      const colonIdx = modelPart.indexOf(':')
      if (colonIdx > 0) {
        return modelPart.slice(0, colonIdx)
      }
      // If no colon, the model name might be the end of the path or followed by /
      const slashIdx = modelPart.indexOf('/')
      if (slashIdx > 0) {
        return modelPart.slice(0, slashIdx)
      }
      return modelPart
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
  private router?: Router

  constructor(
    getProxy: () => UpstreamProxy | null,
    providerChecker?: ProviderChecker,
    modelMappings?: AmpModelMapping[],
    _modelLookup?: ModelLookup, // Deprecated, kept for signature compatibility if needed, or remove
    router?: Router
  ) {
    this.getProxy = getProxy
    this.hasLocalProvider = providerChecker ?? (() => false)
    this.modelMappings = modelMappings
    this.router = router
  }

  wrap(handler: RouteHandler): RouteHandler {
    return async (request: Request, params?: RouteParams): Promise<Response> => {
      // Read body as text immediately.
      // We use text because creating a new Request with string body allows safe cloning downstream,
      // whereas ArrayBuffer-based Requests can have issues with stream locking in Bun.
      const bodyText = await request.text()

      // Log original AMP request for debugging
      try {
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
        body: bodyText,
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
          body: bodyText,
        })
        return handler(restoredRequest, params)
      }

      // Apply model mapping
      const originalModel = model
      const mappingResult = applyModelMappingV2(originalModel, this.modelMappings)
      const mappedModel = mappingResult.model
      const mappedProvider = mappingResult.provider
      let finalBodyText = bodyText

      let detectedProvider: string | undefined

      if (mappedProvider && isValidProviderName(mappedProvider)) {
        detectedProvider = mappedProvider
        logger.info(
          { model: mappedModel, provider: mappedProvider },
          'Explicit provider override via mapping (fallback)'
        )
      }

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
          const json = JSON.parse(bodyText)
          if (json.model) {
            json.model = mappedModel
            finalBodyText = JSON.stringify(json)
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

      // Check if model is available via ModelLookup (via ModelRouter)
      let hasProvider = this.hasLocalProvider(model)

      if (detectedProvider) {
        hasProvider = true
      }

      if (!hasProvider && this.router) {
        try {
          const resolution = await this.router.resolveModel(model)
          // resolveModel will return detected provider if found via lookup or inference
          // We trust it to find a provider if possible.
          // However, resolveModel ALWAYS returns a provider (inference fallback).
          // We need to know if it was actually FOUND in the registry (lookup) vs inferred.
          // Router.resolveModel returns { provider, model }, it wraps ModelRouter.resolve().

          // Ideally we want to know if it's a "valid" provider for this model to confirm "hasProvider".
          // If detection falls back to 'openai' by default inference, it might not mean we HAVE it.
          // But fallback handler's job is to route to local handlers if possible.

          // If we use inference, we assume we can handle it.
          // The goal of this check is: "Should we handle this locally or pass to upstream proxy?"

          // Strategy: If ModelRouter resolves it, we try to handle it locally.
          // EXCEPT if it's just a default fallback and we prefer upstream?
          // Existing logic was: explicitly check lookup.

          // Let's assume if Router resolves it, we treat it as detected.
          // Note: Router uses ModelLookup internally.

          detectedProvider = resolution.provider
          hasProvider = true
          logger.info({ model, provider: detectedProvider }, 'Model resolved via ModelRouter')
        } catch {
          // Router failed
        }
      }

      if (hasProvider) {
        // Use updated body if mapped
        const restoredRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: finalBodyText,
        })

        // If we detected a provider via ModelLookup, call streaming handler directly
        // since the AMP dispatcher may not have a registered handler for this provider
        if (detectedProvider) {
          // Parse body to detect source format
          let sourceFormat: 'openai' | 'anthropic' | 'gemini' = 'anthropic'

          // Try to determine format from URL first
          if (request.url.includes('/v1/messages') && !request.url.includes('/chat/completions')) {
            sourceFormat = 'anthropic'
          } else if (request.url.includes('/v1/chat/completions')) {
            sourceFormat = 'openai'
          } else if (request.url.includes('generateContent')) {
            sourceFormat = 'gemini'
          } else {
            // Fallback to body inspection if URL is ambiguous
            try {
              const text = finalBodyText // Body is already text
              const json = JSON.parse(text)
              const detected = detectFormat(json)
              // Only use detected format if it's one of the standard formats
              if (detected === 'openai' || detected === 'anthropic' || detected === 'gemini') {
                sourceFormat = detected
              }
            } catch {
              // Default to anthropic if parsing fails
            }
          }

          const bodyJson = JSON.parse(finalBodyText)
          const isStreaming = bodyJson.stream === true

          if (isStreaming) {
            logger.info(
              { model, provider: detectedProvider, sourceFormat },
              'Routing to streaming handler'
            )

            return handleStreamingProxy(restoredRequest, {
              sourceFormat,
              targetProvider: detectedProvider,
              targetModel: model,
              thinking: mappingResult.thinking,
              modelMappings: this.modelMappings,
              router: this.router,
            })
          }

          // Non-streaming: use handleProxy with alias and signature handling
          logger.info(
            { model, provider: detectedProvider, sourceFormat },
            'Routing to non-streaming handler'
          )
          return handleProxy(restoredRequest, {
            sourceFormat,
            targetProvider: detectedProvider,
            targetModel: model,
            thinking: mappingResult.thinking,
            modelMappings: this.modelMappings,
            router: this.router,
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
          // Use finalBodyText to ensure mapped model is sent to upstream
          body: finalBodyText,
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
