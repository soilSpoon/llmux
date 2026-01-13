import type { CredentialProvider } from '../auth'
import type { ModelMapping } from '../config'
import { createModelCache } from '../models/cache'
import { createFetcher } from '../models/fetchers'
import { createModelRegistry } from '../models/registry'
import type { ModelProvider, ModelsResponse } from '../models/types'

export interface ModelHandlerOptions {
  credentialProvider?: CredentialProvider
  modelMappings?: ModelMapping[]
}

export async function handleModels(
  request: Request,
  options: ModelHandlerOptions
): Promise<Response> {
  const { credentialProvider, modelMappings } = options
  const url = new URL(request.url)
  const isOpenAICompatible = url.pathname.endsWith('/v1/models')

  if (!credentialProvider) {
    return createModelsResponse({ object: 'list', data: [], providers: [] }, isOpenAICompatible)
  }

  const credentials = await credentialProvider.getAllCredentials()
  const providers = Object.keys(credentials) as ModelProvider[]

  if (providers.length === 0) {
    return createModelsResponse({ object: 'list', data: [], providers: [] }, isOpenAICompatible)
  }

  // Build tokens map (skip providers with token errors)
  const tokens: Record<string, string> = {}
  const validProviders: ModelProvider[] = []
  for (const provider of providers) {
    try {
      const token = await credentialProvider.getAccessToken(provider)
      if (token) {
        tokens[provider] = token
      }
      validProviders.push(provider)
    } catch {
      // Skip provider if token retrieval fails
    }
  }

  // Add gemini-cli as a virtual provider if antigravity credentials exist
  // gemini-cli uses the same OAuth credentials as antigravity but routes to different models
  if (
    providers.includes('antigravity' as ModelProvider) &&
    !validProviders.includes('gemini-cli' as ModelProvider)
  ) {
    validProviders.push('gemini-cli' as ModelProvider)
  }

  // Use ModelRegistry for aggregation and error handling
  const registry = createModelRegistry()
  const cache = createModelCache()

  for (const provider of validProviders) {
    registry.registerFetcher(provider, createFetcher(provider, { cache }))
  }

  const models = await registry.getModels(validProviders, tokens)

  return createModelsResponse(
    {
      object: 'list',
      data: models,
      providers: validProviders,
      mappings: modelMappings,
    },
    isOpenAICompatible
  )
}

function createModelsResponse(body: ModelsResponse, isOpenAICompatible = false): Response {
  if (isOpenAICompatible) {
    return new Response(
      JSON.stringify({
        object: 'list',
        data: body.data,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  const responseBody: ModelsResponse = {
    object: 'list',
    data: body.data,
    providers: body.providers,
  }

  responseBody.mappings = body.mappings ?? []

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
