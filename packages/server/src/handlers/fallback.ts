import { createLogger, isValidProviderName } from '@llmux/core'
import type { ModelMapping } from '../config'
import { detectFormat } from '../middleware/format'
import type { RouteParams } from '../router'
import type { Router } from '../routing'
import type { UpstreamProxy } from '../upstream/proxy'
import { extractModel, type PathParams } from './model-extraction'
import { applyModelMappingV2 } from './model-mapping'
import { handleProxy } from './proxy'
import { handleStreamingProxy } from './streaming'

export { extractModel, type PathParams } from './model-extraction'

export type RouteHandler = (request: Request, params?: RouteParams) => Promise<Response>

const logger = createLogger({ service: 'fallback-handler' })

export type ProviderChecker = (model: string) => boolean

export class FallbackHandler {
  private getProxy: () => UpstreamProxy | null
  private hasLocalProvider: ProviderChecker
  private modelMappings?: ModelMapping[]
  private router?: Router

  constructor(
    getProxy: () => UpstreamProxy | null,
    providerChecker?: ProviderChecker,
    modelMappings?: ModelMapping[],
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
          // Use centralized detectFormat with URL
          const sourceFormat = detectFormat(request.url)

          const bodyJson = JSON.parse(finalBodyText)
          const isStreaming = bodyJson.stream

          if (isStreaming) {
            logger.info(
              { model, provider: detectedProvider, sourceFormat },
              'Routing to streaming handler'
            )

            return handleStreamingProxy(restoredRequest, {
              sourceFormat,
              targetProvider: detectedProvider,
              targetModel: model,
              originalModel,
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
            originalModel,
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
