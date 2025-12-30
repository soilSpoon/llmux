import type { FallbackHandler } from '../handlers/fallback'
import type { Route, RouteParams } from '../router'

export type RouteHandler = (request: Request, params?: RouteParams) => Promise<Response>

export interface ProviderHandlers {
  openai?: RouteHandler
  anthropic?: RouteHandler
  google?: RouteHandler
  [key: string]: RouteHandler | undefined
}

export interface AmpRoutesConfig {
  handlers: ProviderHandlers
  fallbackHandler?: FallbackHandler
  modelsHandler?: RouteHandler
  responsesHandler?: RouteHandler
  upstreamUrl?: string
}

function createProviderDispatcher(
  handlers: ProviderHandlers,
  fallbackHandler?: FallbackHandler
): RouteHandler {
  const dispatcher: RouteHandler = async (request: Request, params?: RouteParams) => {
    const provider = params?.provider
    const handler = provider ? handlers[provider] : undefined

    if (handler) {
      return handler(request, params)
    }

    // No local handler - return error that fallback wrapper will intercept
    return new Response(JSON.stringify({ error: `No handler for provider: ${provider}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (fallbackHandler) {
    return fallbackHandler.wrap(dispatcher)
  }

  return dispatcher
}

function createModelsDispatcher(modelsHandler?: RouteHandler): RouteHandler {
  return async (request: Request, params?: RouteParams) => {
    if (modelsHandler) {
      return modelsHandler(request, params)
    }

    const provider = params?.provider
    return new Response(
      JSON.stringify({
        models: [],
        provider,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

function createUpstreamRedirectHandler(upstreamUrl: string = 'https://ampcode.com'): RouteHandler {
  return async (request: Request) => {
    const url = new URL(request.url)
    const pathname = url.pathname
    const upstreamAddress = new URL(pathname, upstreamUrl).toString()

    return new Response(null, {
      status: 307,
      headers: {
        Location: upstreamAddress,
      },
    })
  }
}

export function createAmpRoutes(config: AmpRoutesConfig): Route[] {
  const { handlers, fallbackHandler, modelsHandler, upstreamUrl } = config

  const chatHandler = createProviderDispatcher(handlers, fallbackHandler)
  const messagesHandler = createProviderDispatcher(handlers, fallbackHandler)
  const geminiHandler = createProviderDispatcher(handlers, fallbackHandler)
  const modelsDispatcher = createModelsDispatcher(modelsHandler)

  const responsesHandler = createProviderDispatcher(handlers, fallbackHandler)
  const redirectHandler = createUpstreamRedirectHandler(upstreamUrl)

  const routes: Route[] = [
    {
      method: 'POST',
      path: '/api/provider/:provider/v1/chat/completions',
      handler: chatHandler,
    },
    {
      method: 'POST',
      path: '/api/provider/:provider/v1/messages',
      handler: messagesHandler,
    },
    {
      method: 'POST',
      path: '/api/provider/:provider/v1/responses',
      handler: responsesHandler,
    },
    {
      method: 'GET',
      path: '/api/provider/:provider/v1/models',
      handler: modelsDispatcher,
    },
    {
      method: 'GET',
      path: '/threads/*path',
      handler: redirectHandler,
    },
    {
      method: 'GET',
      path: '/settings/*path',
      handler: redirectHandler,
    },
  ]

  if (handlers.google) {
    routes.push({
      method: 'POST',
      path: '/v1beta/models/*action',
      handler: async (request: Request, params?: RouteParams) => {
        const googleParams = { ...params, provider: 'google' }
        return geminiHandler(request, googleParams)
      },
    })

    routes.push({
      method: 'POST',
      path: '/api/provider/:provider/v1beta/models/*action',
      handler: geminiHandler,
    })

    // Vertex AI style path: /api/provider/:provider/v1beta1/publishers/google/models/*action
    routes.push({
      method: 'POST',
      path: '/api/provider/:provider/v1beta1/publishers/google/models/*action',
      handler: geminiHandler,
    })
  }

  return routes
}
