import type { ProviderName } from '@llmux/core'
import type { AmpConfig, AmpModelMapping, AmpTarget, RoutingConfig } from '../config'
import { parseModelMapping } from '../handlers/model-mapping'
import type { ModelLookup } from '../models/lookup'

async function resolveProvider(
  target: string | AmpTarget,
  modelLookup: ModelLookup | undefined,
  allMappings: AmpModelMapping[] | undefined,
  visited: Set<string> = new Set()
): Promise<{ provider: ProviderName; model: string } | undefined> {
  const parsed = parseModelMapping(target)
  let provider = parsed.provider as ProviderName

  if (provider) {
    return { provider, model: parsed.model }
  }

  if (modelLookup) {
    provider = (await modelLookup.getProviderForModel(parsed.model)) as ProviderName
    if (provider) {
      return { provider, model: parsed.model }
    }
  }

  // Alias lookup: check if this model is defined as another 'from' mapping
  if (allMappings && !visited.has(parsed.model)) {
    visited.add(parsed.model)
    const alias = allMappings.find((m) => m.from === parsed.model)
    if (alias) {
      const firstTarget = Array.isArray(alias.to) ? alias.to[0] : alias.to
      if (firstTarget) {
        const resolved = await resolveProvider(firstTarget, modelLookup, allMappings, visited)
        if (resolved) {
          return resolved
        }
      }
    }
  }

  // Slash fallback: handle "provider/model" where provider is not in KNOWN_PROVIDERS
  if (typeof target === 'string' && target.includes('/')) {
    const parts = target.split('/')
    const possibleProvider = parts[0]
    if (possibleProvider && /^[a-zA-Z0-9-_]+$/.test(possibleProvider)) {
      return {
        provider: possibleProvider as ProviderName,
        model: target.substring(possibleProvider.length + 1),
      }
    }
  }

  return undefined
}

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

    const resolvedPrimary = await resolveProvider(primaryTarget, modelLookup, modelMappings)

    if (!resolvedPrimary) {
      throw new Error(
        `Provider must be specified for model mapping: ${primaryTarget}. Use format "provider/model" or ensure the model exists in /models endpoint`
      )
    }

    const fallbacks = targets.slice(1)
    const resolvedFallbacks: { provider: ProviderName; model: string; originalName: string }[] = []

    for (const fallback of fallbacks) {
      const resolved = await resolveProvider(fallback, modelLookup, modelMappings)
      if (!resolved) {
        throw new Error(
          `Provider must be specified for fallback mapping: ${fallback}. Use format "provider/model" or ensure the model exists in /models endpoint`
        )
      }
      resolvedFallbacks.push({
        ...resolved,
        originalName: typeof fallback === 'string' ? fallback : fallback.model,
      })
    }

    const fallbackModelIds = resolvedFallbacks.map((r) => r.originalName)

    if (routingConfig.modelMapping) {
      routingConfig.modelMapping[mapping.from] = {
        provider: resolvedPrimary.provider,
        model: resolvedPrimary.model,
        fallbacks: fallbackModelIds,
      }

      if (!routingConfig.modelMapping[resolvedPrimary.model]) {
        routingConfig.modelMapping[resolvedPrimary.model] = {
          provider: resolvedPrimary.provider,
          model: resolvedPrimary.model,
          fallbacks: fallbackModelIds.length > 0 ? fallbackModelIds : undefined,
        }
      }

      for (const resolved of resolvedFallbacks) {
        if (!routingConfig.modelMapping[resolved.originalName]) {
          routingConfig.modelMapping[resolved.originalName] = {
            provider: resolved.provider,
            model: resolved.model,
          }
        }
      }
    }
  }

  return routingConfig
}
