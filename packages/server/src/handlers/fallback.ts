import type { RouteParams } from '../router'
import type { UpstreamProxy } from '../upstream/proxy'

export type RouteHandler = (request: Request, params?: RouteParams) => Promise<Response>

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

  constructor(getProxy: () => UpstreamProxy | null, providerChecker?: ProviderChecker) {
    this.getProxy = getProxy
    this.hasLocalProvider = providerChecker ?? (() => false)
  }

  wrap(handler: RouteHandler): RouteHandler {
    return async (request: Request, params?: RouteParams): Promise<Response> => {
      const bodyBytes = await request.arrayBuffer()
      const bodyForExtraction = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyBytes,
      })

      const pathParams: PathParams = {
        action: params?.action,
        path: params?.path,
      }
      const model = await extractModel(bodyForExtraction, pathParams)

      if (!model) {
        const restoredRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBytes,
        })
        return handler(restoredRequest, params)
      }

      const hasProvider = this.hasLocalProvider(model)

      if (hasProvider) {
        const restoredRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBytes,
        })
        return handler(restoredRequest, params)
      }

      const proxy = this.getProxy()
      if (proxy) {
        const proxyRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBytes,
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
