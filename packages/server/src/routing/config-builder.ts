import type { ProviderName } from '@llmux/core'
import type { AmpConfig, RoutingConfig } from '../config'
import { parseModelMapping } from '../handlers/model-mapping'
import { inferProviderFromModel } from './model-rules'

export function buildRoutingConfig(modelMappings?: AmpConfig['modelMappings']): RoutingConfig {
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
    const primaryProvider =
      (primaryParsed.provider as ProviderName) || inferProviderFromModel(primaryParsed.model || '')

    const fallbacks = targets.slice(1)
    const fallbackModels: string[] = []

    for (const fallback of fallbacks) {
      const fallbackParsed = parseModelMapping(fallback)
      fallbackModels.push(fallbackParsed.model)
    }

    if (routingConfig.modelMapping) {
      routingConfig.modelMapping[mapping.from] = {
        provider: primaryProvider as ProviderName,
        model: primaryParsed.model,
        fallbacks: fallbackModels,
      }

      if (!routingConfig.modelMapping[primaryParsed.model]) {
        routingConfig.modelMapping[primaryParsed.model] = {
          provider: primaryProvider as ProviderName,
          model: primaryParsed.model,
          fallbacks: fallbackModels,
        }
      }

      for (const fallback of fallbacks) {
        const fallbackParsed = parseModelMapping(fallback)
        const fallbackProvider =
          (fallbackParsed.provider as ProviderName) ||
          inferProviderFromModel(fallbackParsed.model || '')

        if (!routingConfig.modelMapping[fallbackParsed.model]) {
          routingConfig.modelMapping[fallbackParsed.model] = {
            provider: fallbackProvider as ProviderName,
            model: fallbackParsed.model,
          }
        }
      }
    }
  }

  return routingConfig
}
