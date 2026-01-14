import type { ProviderName } from '@llmux/core'
import type { AmpTarget, ModelMapping, ModelResolvedConfig, RoutingConfig } from '../config'
import { parseModelMapping } from '../handlers/model-mapping'
import type { ModelLookup } from '../models/lookup'

async function resolveProvider(
  target: string | AmpTarget,
  modelLookup: ModelLookup | undefined,
  allMappings: ModelMapping[] | undefined,
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

interface ResolvedMapping {
  from: string
  primary: { provider: ProviderName; model: string }
  fallbackIds: string[]
  resolvedFallbacks: Array<{ provider: ProviderName; model: string; originalName: string }>
}

export async function buildRoutingConfig(
  modelMappings?: ModelMapping[],
  modelLookup?: ModelLookup
): Promise<RoutingConfig> {
  if (!modelMappings) {
    return {}
  }

  const resolvedMappings: ResolvedMapping[] = []

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
    const resolvedFallbacks: Array<{
      provider: ProviderName
      model: string
      originalName: string
    }> = []

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

    resolvedMappings.push({
      from: mapping.from,
      primary: resolvedPrimary,
      fallbackIds: resolvedFallbacks.map((r) => r.originalName),
      resolvedFallbacks,
    })
  }

  const routingConfig: RoutingConfig = { modelMapping: {} }

  for (const resolved of resolvedMappings) {
    if (!routingConfig.modelMapping) continue

    routingConfig.modelMapping[resolved.from] = {
      provider: resolved.primary.provider,
      model: resolved.primary.model,
      fallbacks: resolved.fallbackIds,
    } satisfies ModelResolvedConfig

    const ownFallbackIds = resolved.fallbackIds
    const existingPrimary = routingConfig.modelMapping[resolved.primary.model]

    if (!existingPrimary) {
      routingConfig.modelMapping[resolved.primary.model] = {
        provider: resolved.primary.provider,
        model: resolved.primary.model,
        fallbacks: ownFallbackIds.length > 0 ? ownFallbackIds : undefined,
      } satisfies ModelResolvedConfig
    } else {
      const existingFallbacks = existingPrimary.fallbacks ?? []
      if (ownFallbackIds.length > existingFallbacks.length) {
        existingPrimary.fallbacks = ownFallbackIds
      }
    }
  }

  for (const resolved of resolvedMappings) {
    if (!routingConfig.modelMapping) continue

    for (const fb of resolved.resolvedFallbacks) {
      if (!routingConfig.modelMapping[fb.originalName]) {
        routingConfig.modelMapping[fb.originalName] = {
          provider: fb.provider,
          model: fb.model,
        } satisfies ModelResolvedConfig
      }
      if (!routingConfig.modelMapping[fb.model]) {
        routingConfig.modelMapping[fb.model] = {
          provider: fb.provider,
          model: fb.model,
        } satisfies ModelResolvedConfig
      }
    }
  }

  return routingConfig
}
