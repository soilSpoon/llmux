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
}

function createProviderDispatcher(
  handlers: ProviderHandlers,
  fallbackHandler?: FallbackHandler
): RouteHandler {
  const dispatcher: RouteHandler = async (request: Request, params?: RouteParams) => {
    const provider = params?.provider
    if (!provider || !(provider in handlers)) {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const handler = handlers[provider]
    if (!handler) {
      return new Response(
        JSON.stringify({ error: `Handler not found for provider: ${provider}` }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    return handler(request, params)
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

export function createAmpRoutes(config: AmpRoutesConfig): Route[] {
  const { handlers, fallbackHandler, modelsHandler } = config

  const chatHandler = createProviderDispatcher(handlers, fallbackHandler)
  const messagesHandler = createProviderDispatcher(handlers, fallbackHandler)
  const geminiHandler = createProviderDispatcher(handlers, fallbackHandler)
  const modelsDispatcher = createModelsDispatcher(modelsHandler)

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
      method: 'GET',
      path: '/api/provider/:provider/v1/models',
      handler: modelsDispatcher,
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
  }

  return routes
}
