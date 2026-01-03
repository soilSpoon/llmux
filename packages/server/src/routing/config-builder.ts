import type { ProviderName } from '@llmux/core'
import type { AmpConfig, RoutingConfig } from '../config'
import { parseModelMapping } from '../handlers/model-mapping'
import type { ModelLookup } from '../models/lookup'

export async function buildRoutingConfig(
  modelMappings?: AmpConfig['modelMappings'],
  modelLookup?: ModelLookup
): Promise<RoutingConfig> {
  if (!modelMappings) {
    return {}
  }

  const routingConfig: RoutingConfig = { modelMapping: {} }

  for (const mapping of modelMappings) {
    const targets = Array.isArray(mapping.to) ? mapping.to : [mapping.to]
    if (targets.length === 0) continue

    const primaryTarget = targets[0]
    if (!primaryTarget) continue
    const primaryParsed = parseModelMapping(primaryTarget)

    let primaryProvider: ProviderName | undefined = primaryParsed.provider as ProviderName

    if (!primaryProvider && modelLookup) {
      primaryProvider = (await modelLookup.getProviderForModel(primaryParsed.model)) as ProviderName
    }

    if (!primaryProvider) {
      throw new Error(
        `Provider must be specified for model mapping: ${primaryTarget}. Use format "model:provider" or ensure the model exists in /models endpoint`
      )
    }

    const fallbacks = targets.slice(1)
    const fallbackModels: string[] = []

    for (const fallback of fallbacks) {
      const fallbackParsed = parseModelMapping(fallback)
      fallbackModels.push(fallbackParsed.model)
    }

    if (routingConfig.modelMapping) {
      routingConfig.modelMapping[mapping.from] = {
        provider: primaryProvider,
        model: primaryParsed.model,
        fallbacks: fallbackModels,
      }

      if (!routingConfig.modelMapping[primaryParsed.model]) {
        routingConfig.modelMapping[primaryParsed.model] = {
          provider: primaryProvider,
          model: primaryParsed.model,
          fallbacks: fallbackModels,
        }
      }

      for (const fallback of fallbacks) {
        const fallbackParsed = parseModelMapping(fallback)

        let fallbackProvider: ProviderName | undefined = fallbackParsed.provider as ProviderName

        if (!fallbackProvider && modelLookup) {
          fallbackProvider = (await modelLookup.getProviderForModel(
            fallbackParsed.model
          )) as ProviderName
        }

        if (!fallbackProvider) {
          throw new Error(
            `Provider must be specified for fallback mapping: ${fallback}. Use format "model:provider" or ensure the model exists in /models endpoint`
          )
        }

        if (!routingConfig.modelMapping[fallbackParsed.model]) {
          routingConfig.modelMapping[fallbackParsed.model] = {
            provider: fallbackProvider,
            model: fallbackParsed.model,
          }
        }
      }
    }
  }

  return routingConfig
}
