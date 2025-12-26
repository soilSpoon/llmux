import type { AmpModelMapping } from '../config'

export function applyModelMapping(model: string, mappings: AmpModelMapping[] | undefined): string {
  if (!mappings || mappings.length === 0) {
    return model
  }

  const mapping = mappings.find((m) => m.from === model)
  if (!mapping) {
    return model
  }

  const to = mapping.to
  if (Array.isArray(to)) {
    return to.length > 0 ? to[0] : model
  }

  return to
}
